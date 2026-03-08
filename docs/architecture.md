# Architecture

This is a walkthrough of how data flows through the system, from raw on-chain logs to the dashboard.

## Pipeline stages

### 1. Ingestion

**What happens:** The ingestion step fetches raw event logs from the Base chain via a JSON-RPC node (Moralis by default) and writes them to disk as JSON. If no RPC URL is configured, it copies pre-committed seed data instead.

**How it works:**

- Uses viem's `createPublicClient` to connect to Base via a standard JSON-RPC endpoint
- Fetches Swap, Mint, and Burn events from the Uniswap V3 pool in batches of 2,000 blocks
- Writes each event type to a separate file: `logs.swap.json`, `logs.mint.json`, `logs.burn.json`
- Fetches block timestamps for all unique blocks and writes `blocks.json`
- All files go to `data/raw/`

**Key design choice:** Raw logs are stored exactly as received from the RPC. No transformation happens at this stage. This means anything downstream can be recomputed from these files, and the source data is auditable.

When there's no RPC URL configured, the ingestion step copies files from `data/seed/` to `data/raw/`. The rest of the pipeline doesn't know or care whether the data came from the network or from seed files.

### 2. Decoding

**What happens:** Raw JSON logs are ABI-decoded into typed, normalized rows, then written as Parquet files.

**How it works:**

- Reads the raw JSON files from `data/raw/`
- Uses viem's `decodeEventLog` with the Uniswap V3 pool ABI to extract typed fields
- Normalizes each event into a flat row with consistent fields: chain, pool address, block number, tx hash, log index, timestamp, day, and event-specific fields
- Writes rows to Parquet via DuckDB (JSON → DuckDB in-memory → Parquet file)
- Output: `swaps.parquet`, `mints.parquet`, `burns.parquet` in `data/intermediate/`

**Why viem for decoding:** viem provides strong TypeScript typing for ABI-decoded events. The decoded args are properly typed, which catches mistakes at compile time rather than runtime.

### 3. Metrics (transformations)

**What happens:** DuckDB runs SQL aggregations over the intermediate Parquet files and produces daily metric tables.

**How it works:**

- Opens an in-memory DuckDB instance
- Reads Parquet files directly with `read_parquet()`
- Runs one SQL query per metric, each producing a new Parquet file in `data/processed/`

Metric tables produced:

| File | Source Parquet | Aggregation |
|---|---|---|
| `daily_fee_estimate.parquet` | swaps | SUM of fee calculation grouped by day |
| `daily_net_liquidity.parquet` | mints, burns | Mint amount minus burn amount per day |
| `daily_active_wallets.parquet` | swaps, mints, burns | Distinct wallets per day, role-classified |
| `daily_swap_count.parquet` | swaps | COUNT per day |
| `daily_volume_proxy.parquet` | swaps | SUM of absolute token0 per day |
| `top_wallets.parquet` | swaps, mints, burns | Ranked by total interactions |

**Why DuckDB:** It runs SQL directly on Parquet files without needing a running database server. This models the same warehouse pattern (SQL over columnar storage) that production systems use with Snowflake or BigQuery, but locally and with no infrastructure.

### 4. Serving layer (API)

**What happens:** A Fastify server reads the precomputed Parquet tables via DuckDB and returns JSON to the frontend.

**Routes:**

| Route | Returns |
|---|---|
| `GET /api/health` | Health check |
| `GET /api/overview` | Pool metadata, latest metric values, pipeline manifest |
| `GET /api/metrics/fees` | Daily fee estimates (supports `?from=&to=` date filtering) |
| `GET /api/metrics/liquidity` | Daily net liquidity change |
| `GET /api/metrics/active-wallets` | Daily active wallets by role |
| `GET /api/metrics/supporting` | Daily swap count + volume proxy |
| `GET /api/wallets/top` | Top interacting wallets |
| `GET /api/lineage` | All metric lineage definitions |
| `GET /api/lineage/:metricName` | Lineage for a specific metric + sample data |

**Query parameters:** The metrics routes accept optional `from` and `to` date parameters (format: `YYYY-MM-DD`), validated with Zod.

**How queries work:** Each request runs a DuckDB query against a Parquet file. DuckDB opens in-memory, reads the Parquet file, applies any filters, and returns rows. The Parquet files are small, so this is fast.

### 5. Caching

**What happens:** An in-memory TTL cache sits in front of each API route. If a request matches a cached key and the entry hasn't expired, the API returns the cached result.

**Details:**

- The `TtlCache` class is a simple `Map<string, { value, expiresAt }>` wrapper
- Overview route uses a 60-second TTL
- Metric routes use a 300-second TTL
- Every response includes a `cache` field with `status: "hit" | "miss"` and `ttlSeconds`

This is the simplest cache that demonstrates the concept. In production you'd swap it for Redis or a CDN cache layer. The interface is the same.

### 6. Frontend

**What happens:** A Vite + React app calls the API and renders charts and tables.

**Pages:**

| Page | Path | What it shows |
|---|---|---|
| Overview | `/` | Pool info, latest metrics, key charts |
| Metrics | `/metrics` | All daily metric charts (fee, liquidity, wallets, swaps, volume) |
| Lineage | `/lineage` | How each metric is derived — formula, source events, source files |
| Wallets | `/wallets` | Top wallets table with role classification |

**Tech:** React 19 with React Router for navigation. Recharts for charts. Tailwind CSS for styling. The Vite dev server proxies `/api` requests to `localhost:3001`.

## Data flow diagram

```
┌──────────────────────────────────────────────────────────────┐
│  Source: RPC node (or data/seed/)                              │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Ingestion                                                    │
│  viem getLogs → raw JSON                                      │
│  Output: data/raw/logs.swap.json                              │
│          data/raw/logs.mint.json                              │
│          data/raw/logs.burn.json                              │
│          data/raw/blocks.json                                 │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Decoding                                                     │
│  viem decodeEventLog → normalized rows → Parquet via DuckDB  │
│  Output: data/intermediate/swaps.parquet                      │
│          data/intermediate/mints.parquet                       │
│          data/intermediate/burns.parquet                       │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Metrics                                                      │
│  DuckDB SQL over Parquet → aggregated Parquet tables          │
│  Output: data/processed/daily_fee_estimate.parquet            │
│          data/processed/daily_net_liquidity.parquet            │
│          data/processed/daily_active_wallets.parquet           │
│          data/processed/daily_swap_count.parquet               │
│          data/processed/daily_volume_proxy.parquet             │
│          data/processed/top_wallets.parquet                    │
│          data/processed/pipeline-manifest.json                 │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  API (Fastify)                                                │
│  DuckDB reads Parquet → JSON responses                        │
│  In-memory TTL cache (60s overview, 300s metrics)             │
│  Cache metadata included in every response                    │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Dashboard (Vite + React)                                     │
│  4 pages: Overview, Metrics, Lineage, Wallets                 │
│  Recharts for visualization, Tailwind for styling             │
└──────────────────────────────────────────────────────────────┘
```

## Pipeline orchestration

The `scripts/run-pipeline.ts` script runs ingestion, decoding, and metrics in sequence. After all three complete, it writes a `pipeline-manifest.json` with:

- Timestamp of the run
- Source (seed or live)
- Chain and pool address
- Block range
- File and row counts
- Duration

This manifest is served by the API's overview endpoint, so the dashboard can show when the data was last built and where it came from.
