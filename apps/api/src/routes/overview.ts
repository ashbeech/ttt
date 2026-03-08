import type { FastifyInstance } from "fastify";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { config, TtlCache } from "@mini-terminal/shared";
import type { PipelineManifest } from "@mini-terminal/shared";
import { query } from "../lib/db.js";

const cache = new TtlCache();
const TTL = 60;

export async function overviewRoutes(app: FastifyInstance) {
  app.get("/api/overview", async (_req, reply) => {
    const cached = cache.get<Record<string, unknown>>("overview");
    if (cached.hit) {
      return reply.send({ data: cached.value, cache: { status: "hit", ttlSeconds: TTL } });
    }

    const procDir = config.paths.processedDir;

    let manifest: PipelineManifest | null = null;
    const manifestPath = resolve(procDir, "pipeline-manifest.json");
    if (existsSync(manifestPath)) {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    }

    const feePath = resolve(procDir, "daily_fee_estimate.parquet");
    const liqPath = resolve(procDir, "daily_net_liquidity.parquet");
    const walPath = resolve(procDir, "daily_active_wallets.parquet");

    const latestFee = existsSync(feePath)
      ? await query(`SELECT * FROM read_parquet('${feePath}') ORDER BY day DESC LIMIT 1`)
      : [];

    const latestLiquidity = existsSync(liqPath)
      ? await query(`SELECT * FROM read_parquet('${liqPath}') ORDER BY day DESC LIMIT 1`)
      : [];

    const latestWallets = existsSync(walPath)
      ? await query(`SELECT * FROM read_parquet('${walPath}') ORDER BY day DESC LIMIT 1`)
      : [];

    const data = {
      pool: config.poolMeta,
      blockRange: manifest?.blockRange ?? { from: config.fromBlock, to: config.toBlock },
      lastPipelineRun: manifest?.runAt ?? null,
      pipelineSource: manifest?.source ?? null,
      latestMetrics: {
        feeEstimate: latestFee[0] ?? null,
        netLiquidity: latestLiquidity[0] ?? null,
        activeWallets: latestWallets[0] ?? null,
      },
      dataFreshness: {
        manifestExists: !!manifest,
        rowCounts: manifest?.rowCounts ?? null,
      },
    };

    cache.set("overview", data, TTL);
    return reply.send({ data, cache: { status: "miss", ttlSeconds: TTL } });
  });
}
