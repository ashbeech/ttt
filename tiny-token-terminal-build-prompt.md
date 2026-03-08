# Tiny Token Terminal — Build Prompt

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
- Fastify
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
