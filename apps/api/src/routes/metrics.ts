import type { FastifyInstance } from "fastify";
import { resolve } from "path";
import { existsSync } from "fs";
import { z } from "zod";
import { config, TtlCache } from "@mini-terminal/shared";
import { query } from "../lib/db.js";

const cache = new TtlCache();
const TTL = 300;

const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function dateFilter(from?: string, to?: string): string {
  const clauses: string[] = [];
  if (from) clauses.push(`day >= '${from}'`);
  if (to) clauses.push(`day <= '${to}'`);
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

async function queryParquet(filename: string, from?: string, to?: string) {
  const filePath = resolve(config.paths.processedDir, filename);
  if (!existsSync(filePath)) return [];
  const filter = dateFilter(from, to);
  return query(`SELECT * FROM read_parquet('${filePath}') ${filter} ORDER BY day`);
}

export async function metricsRoutes(app: FastifyInstance) {
  app.get("/api/metrics/fees", async (req, reply) => {
    const params = dateRangeSchema.parse(req.query);
    const cacheKey = `fees:${params.from ?? ""}:${params.to ?? ""}`;
    const cached = cache.get(cacheKey);
    if (cached.hit) {
      return reply.send({ data: cached.value, cache: { status: "hit", ttlSeconds: TTL } });
    }
    const data = await queryParquet("daily_fee_estimate.parquet", params.from, params.to);
    cache.set(cacheKey, data, TTL);
    return reply.send({ data, cache: { status: "miss", ttlSeconds: TTL } });
  });

  app.get("/api/metrics/liquidity", async (req, reply) => {
    const params = dateRangeSchema.parse(req.query);
    const cacheKey = `liquidity:${params.from ?? ""}:${params.to ?? ""}`;
    const cached = cache.get(cacheKey);
    if (cached.hit) {
      return reply.send({ data: cached.value, cache: { status: "hit", ttlSeconds: TTL } });
    }
    const data = await queryParquet("daily_net_liquidity.parquet", params.from, params.to);
    cache.set(cacheKey, data, TTL);
    return reply.send({ data, cache: { status: "miss", ttlSeconds: TTL } });
  });

  app.get("/api/metrics/active-wallets", async (req, reply) => {
    const params = dateRangeSchema.parse(req.query);
    const cacheKey = `wallets:${params.from ?? ""}:${params.to ?? ""}`;
    const cached = cache.get(cacheKey);
    if (cached.hit) {
      return reply.send({ data: cached.value, cache: { status: "hit", ttlSeconds: TTL } });
    }
    const data = await queryParquet("daily_active_wallets.parquet", params.from, params.to);
    cache.set(cacheKey, data, TTL);
    return reply.send({ data, cache: { status: "miss", ttlSeconds: TTL } });
  });

  app.get("/api/metrics/supporting", async (req, reply) => {
    const params = dateRangeSchema.parse(req.query);
    const cacheKey = `supporting:${params.from ?? ""}:${params.to ?? ""}`;
    const cached = cache.get(cacheKey);
    if (cached.hit) {
      return reply.send({ data: cached.value, cache: { status: "hit", ttlSeconds: TTL } });
    }

    const swapCount = await queryParquet("daily_swap_count.parquet", params.from, params.to);
    const volume = await queryParquet("daily_volume_proxy.parquet", params.from, params.to);

    const data = { swapCount, volumeProxy: volume };
    cache.set(cacheKey, data, TTL);
    return reply.send({ data, cache: { status: "miss", ttlSeconds: TTL } });
  });
}
