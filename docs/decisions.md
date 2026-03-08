# Design decisions

This documents the reasoning behind the main choices in the project.

---

## Why Base

Base is a current, relevant L2 with Uniswap V3 deployed on it. It has real trading activity, reasonable block times, and is well-supported by viem and standard RPC providers like Moralis. It's a practical choice for a demo that needs to feel relevant without requiring mainnet gas analysis or dealing with L1 congestion edge cases.

## Why one pool

Scoping to a single pool (USDC/WETH 0.05%) keeps the demo small and explainable. Every metric, every query, and every chart is about one thing. The architecture doesn't depend on this constraint — the pipeline, decoding, and metric stages work the same way for N pools. But for a demo, one pool means one clear story.

## Why DuckDB

I wanted to model the warehouse pattern — SQL over columnar storage — without needing cloud infrastructure. DuckDB runs in-memory, reads Parquet files natively, and supports standard SQL. It gives me the same mental model as Snowflake or BigQuery (write SQL over structured tables, produce aggregated outputs) but with zero setup.

For a demo, this matters because anyone can clone the repo and run it. No database server, no credentials, no cloud account. The SQL queries in `build-metrics.ts` would translate almost directly to a production warehouse.

## Why raw logs are stored unchanged

I wanted the raw source data to be immutable. The JSON files in `data/raw/` are exactly what came back from the RPC (or from the seed). Nothing is filtered, renamed, or transformed at the ingestion stage.

This means:
- Any downstream computation can be re-derived from the raw data
- If a decoding bug is found, I can fix it and rerun without re-fetching
- The pipeline has a clear audit trail: raw → intermediate → processed

This is the same principle production data platforms use. Raw data is the source of truth. Transformations are applied in later stages and can be versioned independently.

## Why metrics are precomputed

The API serves precomputed Parquet tables rather than running aggregation queries on each request. This is a deliberate separation of compute and serving.

Benefits:
- API responses are fast — DuckDB reads a small Parquet file, not raw event data
- The metric computation runs once during the pipeline, not on every request
- The API layer stays simple — it just reads and returns data
- This matches how production data platforms work: batch compute produces tables, serving layer reads them

The tradeoff is that data isn't real-time. But for daily metrics derived from historical block ranges, that's fine.

## Why Parquet

Parquet is the standard columnar format for analytical workloads. It compresses well, DuckDB reads it natively, and it's supported by every major data tool. Using Parquet means the intermediate and processed data can be inspected with DuckDB CLI, pandas, Polars, or any other tool that reads Parquet.

For this project, Parquet also serves as the interface between pipeline stages. The decoding step writes Parquet, the metrics step reads Parquet and writes Parquet, and the API reads Parquet. Each stage only needs to agree on the file format and schema.

## Why viem over ethers

viem has better TypeScript types, especially for ABI-decoded events. When I decode a Swap event with `decodeEventLog`, the returned args are typed with the correct field names and types from the ABI. This catches errors at compile time.

viem is also more modern in its API design — tree-shakeable, uses native BigInt, and has first-class support for different chains. For a project that's specifically about on-chain data, viem is the more natural fit.

## Why seeded data is first-class

The demo needs to work without any external dependencies. If someone clones the repo, they should be able to run the full pipeline, start the API, and see the dashboard without signing up for any RPC provider account.

The seed data in `data/seed/` is committed to the repo. The ingestion step checks for an RPC URL — if one isn't configured, it copies seed data to `data/raw/` and the rest of the pipeline runs normally. The pipeline manifest records whether the run used seed or live data, so there's no ambiguity.

This also makes the demo reliable in interview or presentation settings where network access might be flaky.

## Why in-memory cache

The `TtlCache` is the simplest cache that demonstrates the concept. It's a `Map` with expiry timestamps. Overview responses are cached for 60 seconds, metric responses for 300 seconds. Every response includes cache metadata (`hit`/`miss` and TTL).

I didn't use Redis because it would add an external dependency for no practical benefit at this scale. The in-memory cache shows the caching pattern — TTL-based expiry, cache key construction, metadata in responses — and could be swapped for Redis by implementing the same `get`/`set` interface.
