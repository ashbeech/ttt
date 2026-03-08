import type { FastifyInstance } from "fastify";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { config } from "@mini-terminal/shared";
import type { MetricLineage } from "@mini-terminal/shared";
import { query } from "../lib/db.js";
import { LINEAGE } from "../lib/lineage-definitions.js";

async function sampleParquet(filePath: string, limit = 5): Promise<Record<string, unknown>[]> {
  if (!existsSync(filePath)) return [];
  return query(`SELECT * FROM read_parquet('${filePath}') LIMIT ${limit}`);
}

function sampleRawLogs(filename: string, limit = 3): Record<string, unknown>[] {
  const filePath = resolve(config.paths.rawDir, filename);
  if (!existsSync(filePath)) return [];
  try {
    const payload = JSON.parse(readFileSync(filePath, "utf-8"));
    return (payload.logs ?? []).slice(0, limit);
  } catch {
    return [];
  }
}

export async function lineageRoutes(app: FastifyInstance) {
  app.get("/api/lineage/:metricName", async (req, reply) => {
    const { metricName } = req.params as { metricName: string };

    const def = LINEAGE[metricName];
    if (!def) {
      return reply.code(404).send({ error: `Unknown metric: ${metricName}` });
    }

    const sampleNormalizedRows: Record<string, unknown>[] = [];
    for (const intFile of def.sourceIntermediateFiles) {
      const fullPath = resolve(config.paths.root, intFile);
      const rows = await sampleParquet(fullPath, 5);
      sampleNormalizedRows.push(...rows);
    }

    const sampleRaw: Record<string, unknown>[] = [];
    for (const rawFile of def.sourceRawFiles) {
      const filename = rawFile.split("/").pop()!;
      sampleRaw.push(...sampleRawLogs(filename, 3));
    }

    const lineage: MetricLineage = {
      ...def,
      sampleNormalizedRows,
      sampleRawLogs: sampleRaw,
    };

    return reply.send({ data: lineage, cache: { status: "miss", ttlSeconds: 10 } });
  });

  app.get("/api/lineage", async (_req, reply) => {
    const metrics = Object.entries(LINEAGE).map(([key, def]) => ({
      key,
      metricName: def.metricName,
      description: def.description,
      formula: def.formula,
      sourceEvents: def.sourceEvents,
    }));
    return reply.send({ data: metrics });
  });
}
