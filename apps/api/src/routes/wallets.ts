import type { FastifyInstance } from "fastify";
import { resolve } from "path";
import { existsSync } from "fs";
import { z } from "zod";
import { config, TtlCache } from "@mini-terminal/shared";
import { query } from "../lib/db.js";

const cache = new TtlCache();
const TTL = 60;

const limitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function walletRoutes(app: FastifyInstance) {
  app.get("/api/wallets/top", async (req, reply) => {
    const { limit } = limitSchema.parse(req.query);
    const cacheKey = `top-wallets:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached.hit) {
      return reply.send({ data: cached.value, cache: { status: "hit", ttlSeconds: TTL } });
    }

    const filePath = resolve(config.paths.processedDir, "top_wallets.parquet");
    if (!existsSync(filePath)) {
      return reply.send({ data: [], cache: { status: "miss", ttlSeconds: TTL } });
    }

    const data = await query(
      `SELECT * FROM read_parquet('${filePath}') ORDER BY total_interactions DESC LIMIT ${limit}`
    );

    cache.set(cacheKey, data, TTL);
    return reply.send({ data, cache: { status: "miss", ttlSeconds: TTL } });
  });
}
