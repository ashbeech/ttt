# Tiny Token Terminal

A small full-stack on-chain analytics demo. It follows the same engineering shape as Token Terminal: raw data → structured events → daily metrics → cached API → dashboard → audit trail.

The target is a single Uniswap V3 pool — USDC/WETH 0.05% on Base (`0xd0b53D9277642d899DF5C87A3966A349A798F224`).

I split the project into ingestion, decoding, metrics, and serving so each stage has one clear job. I wanted to keep the raw source data unchanged so the derived numbers can be traced and recomputed. I used DuckDB and Parquet to model the same warehouse pattern locally without needing cloud infrastructure.

Details on formulas, source events, and caveats are in [docs/metrics.md](docs/metrics.md).

# Original Build Prompt:

"
I’m using **Bun + Vite**.  
Take the current React app in the repo root and convert it into a **monorepo** with:

- a **web dashboard app**
- an **API/data backend app**

## Goal

This project should demonstrate how I think about a full-stack “Tiny Token Terminal” architecture:

- ingesting raw onchain data
- decoding + transforming it in stages
- serving it through an API gateway
- presenting metrics in a dashboard
- preserving an **auditable trail** across the full pipeline

This is not just a UI demo. I want clear data lineage and reproducibility.

## Chain + Data Source

Use **Uniswap V3** pool events on **Base** chain.

- Primary ingestion via **Moralis SDK RPC**
- Use **viem** where useful for contract/event handling
- Decode only what’s needed from ABI (`Swap`, `Mint`, `Burn`), not the full ABI

## Tech Stack

### Frontend (Web Dashboard)

- React 19
- React Router
- Recharts
- Sass styling

### Backend (API / Processing)

- Node.js + TypeScript
- Fastify (I'm used to Express, but hear this might be worth a try for performance in this context)
- Zod for inbound validation

### Data

- DuckDB over Parquet
- Local warehouse-style setup (BigQuery-like flow, but local)

## Monorepo Target Structure

Use Bun workspaces and split apps/packages. Expected shape:

- `apps/web` → React dashboard
- `apps/api` → Fastify API
- `apps/worker` (or scripts package) → pipeline runner
- `packages/shared` → shared types/schemas/constants (optional but preferred)
- `data/raw`
- `data/intermediate`
- `data/processed`
- `data/manifests`

## Data Pipeline (Immutable + Staged)

Implement a 3-stage pipeline:

1. **Ingest**
   - Pull contract logs from RPC (Moralis)
   - Write raw events to `data/raw` as Parquet
   - Raw layer must be append-only/immutable

2. **Decode / Normalize**
   - Decode raw payloads using ABI
   - Produce structured `Swap` / `Mint` / `Burn` records
   - Write to `data/intermediate` as Parquet

3. **Process / Aggregate**
   - Use DuckDB SQL over intermediate Parquet
   - Produce daily metric tables in `data/processed` as Parquet

## Orchestration Requirements

Create a Node.js runner that executes pipeline stages in order:

- Step 1 → Step 2 → Step 3
- Only run next stage if previous stage succeeds
- Concurrency where safe, but preserve dependencies
- Idempotent reruns where possible (avoid duplicates)

Each run must output a **manifest** with:

- run id
- start/end timestamps
- chain + contract + block/date range
- input/output paths
- row counts by stage
- status per stage
- error details on failure

Goal: anyone can audit what happened, when, and why.

## API Gateway Requirements

All dashboard data access must go through Fastify endpoints (no direct file access from frontend).

Use:

- Fastify route schemas
- Zod validation for params/query/body
- typed responses in TypeScript
- in-memory caching for expensive reads
- clear extension points for rate limiting/auth

## Required API Endpoints (Minimum)

- `GET /health`
- `GET /metrics/daily?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /metrics/liquidity?start=...&end=...`
- `GET /metrics/fees?start=...&end=...`
- `GET /metrics/swaps/count?start=...&end=...`
- `GET /metrics/volume-proxy?start=...&end=...`
- `GET /wallets/active?start=...&end=...`
- `GET /wallets/top?limit=...&start=...&end=...`
- `GET /pipeline/runs` (manifest history)

## Dashboard Requirements

The React app should call the API and present:

1. Daily fee estimate (from swaps)
2. Net liquidity change (`mint - burn` per day)
3. Active wallets labeled as:
   - `Swapper`
   - `Liquidity Provider`
   - `Both`
4. Daily swap count
5. Daily volume proxy (sum of absolute token0 amount per day)
6. Top wallets ranked by total interactions + role

Include:

- date-range filtering
- loading / empty / error states
- chart + table views where useful

## Constraints / Intent

- Never mutate raw data
- Keep everything local using Parquet + DuckDB
- Strong compile-time typing in TS, runtime validation at API boundary
- Prioritize architecture clarity + auditability over over-optimization

## Deliverables

- Working monorepo with Bun workspaces
- Runnable pipeline scripts
- Fastify API with endpoints above
- React dashboard consuming API
- Example dataset + at least one successful manifest run
- README with commands for:
  - install
  - ingest
  - transform
  - run API
  - run web app
    "

## How to run

### 1. Install dependencies

```bash
bun install
```

### 2. Run the pipeline

```bash
bun run pipeline
```

This builds everything from seeded data by default — no external API key needed. The pipeline runs ingestion → decoding → metrics and writes a manifest to `data/processed/pipeline-manifest.json`.

### 3. Start the API

```bash
bun run apps/api/src/server.ts
```

API starts on `http://localhost:3001`. The API serves precomputed metric tables rather than recalculating everything on each request.

### 4. Start the dashboard

In another terminal:

```bash
cd apps/web && bun run dev
```

Dashboard starts on `http://localhost:5173`. The Vite dev server proxies `/api` requests to the API.

### 5. Run tests

```bash
bun test
```

Tests verify Parquet schemas, metric formulas, row counts, and cache behavior.

### 6. Connect the MCP server (optional)

The MCP server uses stdio transport — it is spawned by an MCP-compatible client (Cursor, Claude Desktop, etc.), not run manually in a terminal.

**Prerequisites:** the Fastify API must be running (`bun run dev:api`).

Add the following to your MCP client config:

**Cursor** (`.cursor/mcp.json` in the project root):

```json
{
  "mcpServers": {
    "mini-terminal": {
      "command": "bun",
      "args": ["run", "apps/mcp/src/server.ts"],
      "env": {
        "MCP_API_BASE_URL": "http://127.0.0.1:3001"
      }
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mini-terminal": {
      "command": "bun",
      "args": ["run", "apps/mcp/src/server.ts"],
      "cwd": "/absolute/path/to/ttt",
      "env": {
        "MCP_API_BASE_URL": "http://127.0.0.1:3001"
      }
    }
  }
}
```

Optional environment variables:

- `MCP_API_BASE_URL` (default: `http://127.0.0.1:3001`)
- `MCP_TIMEOUT_MS` (default: `6000`)
- `MCP_MAX_DATE_SPAN_DAYS` (default: disabled; set to a positive integer to enforce)

### Live data

To fetch real data from Base instead of using the seed:

1. Create a `.env` file in the project root
2. Set `RPC_URL=https://site1.moralis-nodes.com/base/YOUR_KEY`
3. Run `bun run pipeline`

The pipeline detects the key and fetches live logs from the RPC. You can also adjust `FROM_BLOCK` and `TO_BLOCK` in `.env`.

## Tech stack

| Layer    | Tech                                          |
| -------- | --------------------------------------------- |
| Runtime  | Bun                                           |
| Frontend | Vite + React 19, React Router, Recharts, Sass |
| API      | Fastify, Zod, in-memory TTL cache             |
| Data     | DuckDB (in-memory), Parquet on disk           |
| Chain    | viem, Base (Moralis RPC nodes)                |

## Repo structure

```
├── apps/
│   ├── api/                 Fastify API server
│   │   └── src/
│   │       ├── server.ts    Entry point
│   │       ├── routes/      Overview, metrics, wallets, lineage
│   │       └── lib/         DuckDB helper, lineage definitions
│   ├── mcp/                 MCP adapter server (stdio tools)
│   │   └── src/
│   │       ├── server.ts    MCP server entry point
│   │       └── lib/         Tool registration + API/manifest adapters
│   └── web/                 React dashboard
│       └── src/
│           ├── pages/       Overview, Metrics, Lineage, Wallets
│           ├── components/  Layout, MetricCard, ChartCard, DataTable
│           └── lib/         API client
├── packages/
│   ├── shared/              Config, types, ABI, helpers, cache
│   ├── ingestion/           Fetches pool events from RPC or seed
│   ├── decoding/            ABI-decodes raw logs → Parquet
│   └── metrics/             DuckDB SQL → metric Parquet tables
├── scripts/
│   ├── run-pipeline.ts      Orchestrates ingestion → decode → metrics
│   ├── generate-seed.ts     Deterministic seed generator
│   └── seed-from-live.ts    Fetch live data and save as seed
├── data/
│   ├── raw/                 Raw JSON logs (unchanged source)
│   ├── intermediate/        Decoded Parquet (swaps, mints, burns)
│   ├── processed/           Metric Parquet tables + manifest
│   └── seed/                Committed seed data for offline runs
└── tests/
    └── metrics.test.ts      Pipeline and cache tests
```

## Extending

### MCP tools (v1)

The MCP server is a thin adapter over the API. It does not duplicate SQL or pipeline logic. Current tools:

- `get_health`
- `get_overview`
- `get_fees`
- `get_liquidity`
- `get_active_wallets`
- `get_supporting_metrics`
- `get_top_wallets`
- `list_lineage_metrics`
- `get_metric_lineage`
- `get_pipeline_manifest`

The pipeline is designed to scale horizontally. To add a new pool:

1. Add the pool address and metadata to `packages/shared/src/config.ts`
2. Ingestion already fetches Swap, Mint, and Burn events — it works for any Uniswap V3 pool
3. Decoding uses the same ABI, so new pools produce the same normalized rows
4. Add new metric queries or modify existing ones in `packages/metrics/src/build-metrics.ts`
5. Add API routes and dashboard pages as needed

To add a new metric:

1. Write the DuckDB SQL in `build-metrics.ts`
2. Add a lineage definition in `apps/api/src/lib/lineage-definitions.ts`
3. Add a route in `apps/api/src/routes/`
4. Display it in the dashboard

## Simplifications

This is a demo scoped to one pool and one block range. Some things I kept simple on purpose:

- **Fee estimate uses absolute amount0 only.** In production you'd apply price feeds and account for token direction.
- **Volume proxy is not precise economic volume.** It's a transparent, consistent proxy using absolute token0 amounts.
- **Net liquidity uses a pool-derived WETH price, not an oracle.** The WETH/USDC price is a volume-weighted average from the pool's own swap data. This keeps the system self-contained and auditable. In production you'd use a TWAP oracle (e.g. Uniswap V3's `observe()`) or Chainlink price feed mapped to transaction timestamps for more precise per-event pricing.
- **One pool, one chain.** The architecture supports multiple pools and chains, but the demo targets one to keep it explainable.
- **In-memory cache.** Works for a demo; in production you'd use Redis or similar.
- **No incremental updates.** The pipeline rebuilds from scratch each run. Adding incremental processing is straightforward but adds complexity that doesn't help the demo.
- **Block range is fixed.** Configurable via env vars, but the seed data covers a specific ~~50k-block~~ 5k-block window (`43,041,220` to `43,046,220`). Moralis free-tier rate limits were aggressive enough that narrowing the default range made pipeline runs reliable for a local demo.

## UX decisions

- **Net liquidity as a single USD figure.** The raw Uniswap V3 `amount` field (internal liquidity units) is meaningless to a user. I first tried showing separate WETH and USDC deltas, but two unrelated numbers side by side is clunky — you can't quickly tell if liquidity went up or down without doing mental math. Converting to a single dollar value gives immediate signal. The WETH price is derived from the pool's own swaps rather than an external oracle, which I'd flag in a production context but is a reasonable trade-off for a self-contained demo. The per-token breakdown is preserved in the data and visible via the Metrics detail view for anyone who wants it.
