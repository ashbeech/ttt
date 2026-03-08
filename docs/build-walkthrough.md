# How I built mini-terminal, step by step

This is a walkthrough of how the project was put together, starting from an empty Vite React scaffold. Each step explains what I did, why I did it that way, and what the key implementation details are.

---

## Step 0: Starting point

I ran `bun create vite` and picked the React + TypeScript template. That gave me a single flat project with `src/`, `index.html`, `vite.config.ts`, and the default App component.

The first decision is that this default structure isn't going to work. The spec calls for a data pipeline (ingestion, decoding, metrics), a separate API server, and a frontend dashboard. Keeping all of that in one flat `src/` folder would be messy and hard to explain. So the first real step is restructuring.

---

## Step 1: Restructure into a monorepo

**Decision:** Split the project into `apps/` and `packages/` using bun workspaces.

I deleted the default Vite scaffold files (`src/`, `index.html`, `vite.config.ts`, the default tsconfigs) and created this folder structure:

```
mini-terminal/
  apps/
    web/          ← the React dashboard (Vite lives here now)
    api/          ← the Fastify API server
  packages/
    shared/       ← types, config, helpers used everywhere
    ingestion/    ← fetches raw logs from RPC node
    decoding/     ← ABI-decodes raw logs into typed rows
    metrics/      ← aggregates decoded events into daily metrics
  data/
    raw/          ← raw JSON payloads from RPC (gitignored)
    intermediate/ ← decoded event tables as Parquet (gitignored)
    processed/    ← final metric tables as Parquet (gitignored)
    seed/         ← committed sample data for zero-dependency demos
  scripts/        ← pipeline runner, seed generation
  tests/          ← metric calculation tests
  docs/           ← architecture, metrics, decisions docs
```

The root `package.json` declares workspaces:

```json
{
  "workspaces": ["apps/*", "packages/*"]
}
```

**Why this structure:** Each pipeline stage has one clear job. When I walk someone through the code, I can point to a folder and say "this does ingestion" or "this does decoding" and there's nothing else in there muddying the story. It's also the same shape you'd use in a production data platform — ingestion, transformation, serving are separate concerns.

**What I installed at the root:**

```bash
bun add viem @duckdb/node-api@1.4.4-r.3
```

These are needed by the pipeline scripts that run from the repo root. Each app and package also declares its own dependencies in its own `package.json`.

---

## Step 2: Build the shared package

**Decision:** Centralise all types, config, ABI definitions, and helpers in one package that everything else imports from.

### `packages/shared/src/config.ts`

This is the single source of truth for all configuration. It reads from environment variables with sensible defaults:

- `RPC_URL` — empty by default, so the pipeline falls back to seed data
- `POOL_ADDRESS` — defaults to the USDC/WETH 0.05% pool on Base
- `POOL_FEE_TIER` — 0.0005 (0.05%)
- `FROM_BLOCK` / `TO_BLOCK` — a 50,000 block window
- `API_PORT` — 3001

It also contains `poolMeta` (human-readable pool info for the frontend) and `paths` (resolved absolute paths to data directories).

**Key detail:** Paths are resolved relative to the shared package location using `import.meta.dirname`, then walking up three levels to reach the repo root. This means every package that imports config gets consistent, absolute paths regardless of where it's run from.

### `packages/shared/src/abi.ts`

The Uniswap V3 pool ABI, trimmed to just the three events I care about: Swap, Mint, Burn.

**Decision:** I only include the event definitions I need, not the full pool ABI. This keeps it readable and makes it obvious exactly which events the pipeline handles.

**Key detail for Swap:** `amount0` is `int256` (signed) — it can be negative, which matters for the fee calculation later. `amount1` is also signed. `sender` and `recipient` are indexed.

**Key detail for Mint:** `sender` is NOT indexed (it's in the data), but `owner`, `tickLower`, and `tickUpper` ARE indexed (they're in the topics). This distinction matters during decoding because indexed params go into topics and non-indexed params go into data.

**Key detail for Burn:** `owner` is indexed, and there's no `sender` field. Burn has 3 indexed params (owner, tickLower, tickUpper) and 3 non-indexed (amount, amount0, amount1).

### `packages/shared/src/types.ts`

Every data shape in the project is defined here:

- **`RawLogPayload`** — the wrapper around raw RPC logs, with metadata (chain, pool, block range, fetch time). This is what gets saved to `data/raw/`.
- **`RawLog`** — a single log entry exactly as it comes from the RPC (address, blockNumber as hex, data, topics).
- **`NormalizedSwap` / `NormalizedMint` / `NormalizedBurn`** — the decoded, typed rows that go into Parquet. Every field has a clear name (`block_number` not `blockNumber`, `tx_hash` not `transactionHash`). Amounts are stored as strings because they're BigInts that could exceed Number precision.
- **Metric types** — `DailyFeeEstimate`, `DailyNetLiquidity`, `DailyActiveWallets`, etc.
- **`PipelineManifest`** — metadata about each pipeline run (duration, row counts, source).
- **`MetricLineage`** — what the lineage endpoint returns (formula, source files, sample rows).

### `packages/shared/src/cache.ts`

A simple TTL cache implemented as a `Map` with expiry timestamps. The `get` method returns a discriminated union — `{ hit: true, value: T }` or `{ hit: false }` — so the caller always knows whether it's a cache hit without null-checking.

### `packages/shared/src/helpers.ts`

Small utilities: `unixToDay` (unix timestamp to `YYYY-MM-DD`), `formatTokenAmount` (BigInt to human-readable number with decimals), `sleep`.

---

## Step 3: Build the ingestion package

**Decision:** The ingestion step has two paths — live fetch from an RPC node, or copy from seed data. Seed is the default.

### `packages/ingestion/src/fetch-pool-events.ts`

The script checks `config.rpcUrl`. If it's empty or contains `YOUR_KEY`, it copies files from `data/seed/` to `data/raw/` and exits. No RPC call needed.

**For the live path,** it uses viem's `createPublicClient` with the Base chain and an HTTP transport pointed at the RPC URL (Moralis, Alchemy, or any JSON-RPC provider). For each event type (Swap, Mint, Burn):

1. Walk through the block range in batches of 2,000 blocks
2. Call `client.getLogs()` with the event signature and pool address
3. Collect all logs and track unique block numbers
4. Write the full payload to `data/raw/logs.swap.json` (or mint/burn)

After fetching event logs, it fetches block timestamps for every unique block number. These are needed in the decoding step to derive the `day` field.

**Key decisions:**

- **Batch size of 2,000:** RPC providers have response size limits. 2,000 blocks per request stays well within those limits.
- **Sleep 100ms between batches:** Basic rate limiting to avoid hitting provider rate caps.
- **Block timestamps fetched in batches of 50:** `getBlock` is one call per block. Batching with `Promise.all` keeps it fast without hammering the RPC.
- **Raw payloads saved unchanged:** The JSON files contain the exact RPC response data plus metadata. Nothing is decoded, filtered, or renamed. This is important — it means the raw data is always the source of truth and any downstream bug can be fixed by re-running decode, not re-fetching.

---

## Step 4: Build the decoding package

**Decision:** Decode raw logs using viem's `decodeEventLog` and the pool ABI, then write typed rows to Parquet via DuckDB.

### `packages/decoding/src/decode-events.ts`

The script loads the three raw JSON files and the block timestamps, then runs three decode functions: `decodeSwaps`, `decodeMints`, `decodeBurns`.

**How decoding works:**

Each raw log has `data` (the non-indexed parameters, ABI-encoded) and `topics` (the event signature hash plus indexed parameters). viem's `decodeEventLog` takes the ABI, data, and topics and returns typed args.

For a Swap log:
- `topics[0]` is the event signature hash
- `topics[1]` is `sender` (indexed address, padded to 32 bytes)
- `topics[2]` is `recipient` (indexed address)
- `data` contains `amount0`, `amount1`, `sqrtPriceX96`, `liquidity`, `tick` packed together

viem handles all of this — I just pass the ABI and the raw log fields.

**Key detail:** Amounts come back as `bigint`. I convert them to strings for storage because Parquet via DuckDB handles strings cleanly, and BigInt values can exceed JavaScript's `Number.MAX_SAFE_INTEGER`. The metrics step casts them back to `DOUBLE` in SQL, which has enough precision for the aggregations I'm doing.

**Writing Parquet:** I write the decoded rows as a temporary JSON file, then use DuckDB's `read_json_auto` to ingest them and `COPY ... TO ... (FORMAT PARQUET)` to write Parquet. This avoids dealing with Parquet libraries directly — DuckDB handles the schema inference and columnar encoding.

**Output:** Three Parquet files in `data/intermediate/`: `swaps.parquet`, `mints.parquet`, `burns.parquet`.

---

## Step 5: Build the metrics package

**Decision:** Use DuckDB SQL to aggregate the intermediate Parquet tables into daily metric tables. Each metric is one SQL query that reads Parquet and writes Parquet.

### `packages/metrics/src/build-metrics.ts`

This is the most analytically interesting file. Each metric is built with a single `COPY (SELECT ...) TO '...' (FORMAT PARQUET)` statement.

**Daily fee estimate:**

```sql
SELECT
  day,
  'WETH' AS fee_token,
  SUM(ABS(CAST(amount0 AS DOUBLE)) / POW(10, 18) * 0.0005) AS fee_estimate,
  COUNT(*) AS swap_count
FROM read_parquet('swaps.parquet')
GROUP BY day
ORDER BY day
```

The formula: for each swap, take the absolute value of `amount0` (which is in raw wei), divide by 10^18 to get WETH units, multiply by the fee tier (0.0005 = 0.05%). Sum by day.

**Simplification acknowledged:** This uses `amount0` regardless of swap direction. In a real system you'd want to account for which token is "in" and which is "out", and possibly apply a price feed. For this demo, using absolute amount0 with the fee tier is transparent and consistent. I document this everywhere.

**Daily net liquidity:**

Uses a CTE pattern: aggregate mints by day, aggregate burns by day, FULL OUTER JOIN on day to handle days with only mints or only burns, then compute `liquidity_added - liquidity_removed`.

**Decision:** I use the `amount` field (liquidity units) from Mint/Burn, not `amount0`/`amount1`. This is the raw liquidity delta, not a token amount. It's the most honest representation of what the events actually track.

**Daily active wallets:**

This is the most complex query. I build two sets: swap wallets (sender + recipient from Swap events) and LP wallets (owner from Mint + Burn events). FULL OUTER JOIN on day + wallet, then classify:
- Wallet in swaps only → `swapper`
- Wallet in mints/burns only → `lp`
- Wallet in both on the same day → `both`

Count distinct wallets per role per day.

**Daily swap count and volume proxy:** Straightforward `COUNT` and `SUM(ABS(...))` by day.

**Top wallets:** Union all interactions (swap sender, swap recipient, mint owner, burn owner), count by wallet, classify by role, sort by total interactions.

---

## Step 6: Build the pipeline runner

**Decision:** One script that runs ingestion → decoding → metrics in sequence, then writes a manifest JSON.

### `scripts/run-pipeline.ts`

Uses `Bun.spawn` to run each step as a child process. If any step exits non-zero, the pipeline stops.

After all three steps complete, it queries the Parquet files to count rows and writes a `pipeline-manifest.json` to `data/processed/`. The manifest records:
- When the pipeline ran
- Whether it used seed or live data
- Block range
- File counts and row counts per table
- Total duration

The API reads this manifest to populate the "data freshness" panel on the dashboard.

---

## Step 7: Generate and commit seed data

**Decision:** The demo must work without an RPC key. Seed data is committed to the repo.

### `scripts/generate-seed.ts`

This script generates deterministic, realistic-looking raw log data. It uses a seeded pseudo-random number generator (simple LCG with seed 42) so the output is always the same.

It creates:
- ~930 Swap events across 5 days (150-250 per day)
- ~96 Mint events (10-30 per day)
- ~55 Burn events (5-15 per day)
- ~1,070 block timestamps

The logs have properly encoded `data` and `topics` fields using viem's `encodeAbiParameters`. The event signature hashes in `topics[0]` are computed with `keccak256(toBytes("Swap(address,address,int256,int256,uint160,uint128,int24)"))` to match what viem's `decodeEventLog` expects.

A pool of 30 wallet addresses is reused across events so the "top wallets" metric shows realistic concentration.

**Key detail:** The data structure exactly matches what an RPC node would return. The decoding step doesn't know or care whether the data is seeded or live.

---

## Step 8: Build the API

**Decision:** Fastify for the HTTP server, DuckDB for reading Parquet files, Zod for query parameter validation, in-memory TTL cache for responses.

### `apps/api/src/server.ts`

Registers CORS (so the Vite dev server can call it), then registers four route modules: overview, metrics, wallets, lineage.

### `apps/api/src/lib/db.ts`

A singleton DuckDB instance. The `query` function opens a connection, runs SQL, converts the result rows from DuckDB's internal format to plain objects, and handles type conversions (BigInt → Number, DuckDB DATE → ISO string).

**Key detail:** DuckDB returns DATE columns as `{ days: number }` objects (epoch days). The query helper converts these to `YYYY-MM-DD` strings so the API returns clean JSON.

### Route: `/api/overview`

Reads the pipeline manifest for metadata (block range, last run time, source). Queries each headline metric table for the most recent day's values. Returns pool metadata, latest metrics, and data freshness info.

Cached for 60 seconds.

### Route: `/api/metrics/fees` (and `/liquidity`, `/active-wallets`, `/supporting`)

Each endpoint takes optional `from` and `to` query parameters (validated by Zod as `YYYY-MM-DD` strings). Reads the corresponding Parquet file through DuckDB with a date filter.

Cached for 300 seconds. Cache key includes the date range so different queries get separate cache entries.

### Route: `/api/wallets/top`

Takes a `limit` parameter (validated by Zod, default 50, max 200). Reads `top_wallets.parquet`.

### Route: `/api/lineage/:metricName`

This is the most important endpoint for the interview.

For each metric, a static definition in `lineage-definitions.ts` specifies:
- The metric name and description
- The formula in plain English
- Which source events it uses
- Which raw files and intermediate files it reads from

When the endpoint is called, it combines this static definition with live sample data — 5 sample rows from the intermediate Parquet table and 3 sample raw log entries from the JSON files.

**Decision:** Lineage definitions are static, not computed. This is deliberate — the formula and source mapping don't change between requests. Fetching sample data is the only dynamic part.

### Cache strategy

Every response includes cache metadata:

```json
{
  "data": { ... },
  "cache": { "status": "hit", "ttlSeconds": 300 }
}
```

This makes caching visible to the frontend and to anyone inspecting the API. It's a serving-layer pattern worth talking about in an interview — the API is explicit about whether the data came from cache.

TTLs:
- Overview: 60s (changes with pipeline runs)
- Time series metrics: 300s (changes slowly, read often)
- Top wallets: 60s
- Lineage: not cached long (it's trace/debug data)

---

## Step 9: Build the frontend

**Decision:** Vite + React + React Router for routing, Recharts for charts, Tailwind CSS for styling. The frontend calls the API — it never reads data files directly.

### Setup

The Vite project lives in `apps/web/`. Key config:

- **`vite.config.ts`** proxies `/api` to `http://localhost:3001` so the frontend dev server forwards API calls to the Fastify server. No CORS issues during development.
- **`index.css`** is just `@import "tailwindcss"` — Tailwind v4 with the Vite plugin handles everything.
- Dark theme: the HTML body has `class="bg-gray-950 text-gray-100"`.

### `src/lib/api.ts`

A thin API client with typed functions for each endpoint. Each function calls `fetch`, checks for errors, parses JSON, and returns a typed result. The frontend never constructs URLs or deals with raw fetch calls directly.

### `src/components/Layout.tsx`

A shared layout with a sticky nav header and a `<Outlet />` for page content. Navigation uses React Router's `NavLink` with active state styling.

### `src/components/MetricCard.tsx`

A reusable card component for headline numbers. Takes a title, value, subtitle, and accent colour. Used on the overview page for the three headline metrics.

### `src/components/ChartCard.tsx`

A container for Recharts charts with a title and description.

### `src/components/DataTable.tsx`

A generic table component that takes column names and rows. Handles number formatting, address truncation (`0xabcd...ef12`), and row limits.

### Page: Overview (`/`)

Fetches overview, fees, liquidity, and active wallets data in parallel on mount. Renders:

1. Pool header (name, chain, fee tier)
2. Three metric cards (fee estimate, net liquidity, active wallets)
3. Three charts (fee estimate area chart, net liquidity stacked bar, active wallets stacked bar)
4. Info panel (cache status, data source, block range, last run, event counts)

### Page: Metrics (`/metrics`)

Shows all five metric sections. Each section has:
- Title and description
- The formula in monospace text
- A chart (Recharts)
- A toggle to show/hide the raw data table

**Decision:** Show the formula on screen, not just in docs. During an interview walkthrough I can point at the formula next to the chart and explain exactly what's being computed.

### Page: Lineage (`/lineage`)

Expandable accordion cards for each metric. When expanded, shows:
- The formula
- Source raw files (e.g., `data/raw/logs.swap.json`)
- Source intermediate files (e.g., `data/intermediate/swaps.parquet`)
- Sample normalized rows in a table
- Sample raw log entries as formatted JSON

**This page is the differentiator.** It proves that every derived number can be traced back to a specific event table, which came from a specific raw file, which was fetched from a specific block range. That's the audit trail.

### Page: Wallets (`/wallets`)

A ranked table of the top 50 wallets by interaction count. Each row shows the truncated address, role badge (swapper / liquidity provider / both), and individual counts for swaps, mints, burns.

---

## Step 10: Write tests

**Decision:** Focus tests on metric calculations, not UI. The tests verify that the pipeline output is correct and internally consistent.

### `tests/metrics.test.ts`

Uses `bun:test`. Reads the Parquet files directly with DuckDB (the same way the API does).

**What the tests check:**

- All intermediate and processed files exist after a pipeline run
- Normalized tables have the expected columns
- Fee estimate is positive and matches a manual recalculation from the raw swap data
- Swap counts in the fee table sum to the total number of swaps
- `net_liquidity_change = liquidity_added - liquidity_removed` for every row
- `active_total = active_swappers + active_lps + active_both` for every row
- `total_interactions = swap_count + mint_count + burn_count` for every wallet
- Role classification is consistent (wallet with swaps + mints = "both", swaps only = "swapper", etc.)
- Top wallets are sorted descending by total interactions
- The TTL cache works correctly (set, get hit, get miss)

**The strongest test:** The fee estimate cross-check runs the same SQL formula against the intermediate swap table and compares it to the processed metric table. If they don't match within 0.000001, the test fails. This proves the metric pipeline is computing what it says it's computing.

---

## Step 11: Write documentation

Four files:

- **`README.md`** — what the project is, how to run it, what the metrics mean, how to extend it
- **`docs/architecture.md`** — plain English walkthrough of each pipeline stage
- **`docs/metrics.md`** — formula, source events, caveats for each metric
- **`docs/decisions.md`** — why Base, why one pool, why DuckDB, why raw logs are immutable, etc.

**Decision:** Write in first person, keep it plain and direct. No academic language, no marketing copy. The tone should sound like a developer explaining their own code to a colleague.

---

## Step 12: Verify everything works end to end

The final check:

```bash
bun install
bun run pipeline        # 0.5 seconds — copies seed, decodes, builds metrics
bun test                # 17 tests, 144 assertions, 0 failures
bun run dev:api         # API on localhost:3001
bun run dev:web         # Dashboard on localhost:5173
```

All API endpoints return clean JSON with proper date strings and cache metadata. The dashboard loads all four pages, charts render, lineage expands with sample data.

---

## Gotchas I hit during the build

**DuckDB package compatibility:** The old `duckdb` npm package uses node-gyp and failed to build with Node 23. Switched to `@duckdb/node-api` (the newer, NAPI-based package). The version numbers use a `-r.X` suffix that isn't semver compatible with `^`, so I had to pin `1.4.4-r.3` exactly.

**DuckDB DATE type in API responses:** DuckDB returns DATE columns as `{ days: number }` objects (epoch days since 1970-01-01), not as strings. The API's query helper converts these to `YYYY-MM-DD` strings.

**Event signature hashes for seed data:** When generating seed data, the topic0 hash has to match what viem expects when decoding. The Burn event signature is `Burn(address,int24,int24,uint128,uint256,uint256)` — not `Burn(address,address,int24,int24,...)`. The number of params and their types must exactly match the ABI definition.

**BigInt handling across the pipeline:** Raw event amounts are BigInt, which can't be JSON-serialized or stored as JavaScript Numbers safely. I store them as strings in the normalized tables and cast to DOUBLE in DuckDB SQL. For the aggregations I'm doing (sums of token amounts), DOUBLE precision is sufficient.

---

## If I had more time

Things I'd add, in order of priority:

1. Date range filter in the frontend (the API already supports `from` and `to` params)
2. CSV export for metric tables
3. A "re-run pipeline" button in the UI for local dev
4. A data freshness badge in the nav
5. More tests — API endpoint integration tests, snapshot tests for seed data
6. Live data fetch from Base mainnet as a CI job to keep seed data fresh
