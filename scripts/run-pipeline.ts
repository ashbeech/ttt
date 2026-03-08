import { writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { config } from "@mini-terminal/shared";
import type { PipelineManifest } from "@mini-terminal/shared";
import { DuckDBInstance } from "@duckdb/node-api";

function countFiles(dir: string, ext: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(ext)).length;
}

async function queryCount(path: string): Promise<number> {
  if (!existsSync(path)) return 0;
  try {
    const inst = await DuckDBInstance.create(":memory:");
    const conn = await inst.connect();
    const reader = await conn.runAndReadAll(
      `SELECT COUNT(*) AS c FROM read_parquet('${path}')`
    );
    const rows = reader.getRows();
    return Number(rows[0]?.[0] ?? 0);
  } catch {
    return 0;
  }
}

async function run(step: string, scriptPath: string): Promise<void> {
  console.log(`\n▸ Running ${step}...`);
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env },
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${step} failed with exit code ${code}`);
}

async function main() {
  const startTime = Date.now();
  console.log("╔══════════════════════════════════════╗");
  console.log("║    mini-terminal pipeline runner     ║");
  console.log("╚══════════════════════════════════════╝");

  await run("ingestion", "packages/ingestion/src/fetch-pool-events.ts");
  await run("decoding", "packages/decoding/src/decode-events.ts");
  await run("metrics", "packages/metrics/src/build-metrics.ts");

  const intDir = config.paths.intermediateDir;
  const procDir = config.paths.processedDir;

  const swapCount = await queryCount(resolve(intDir, "swaps.parquet"));
  const mintCount = await queryCount(resolve(intDir, "mints.parquet"));
  const burnCount = await queryCount(resolve(intDir, "burns.parquet"));
  const metricFileCount = countFiles(procDir, ".parquet");

  const durationMs = Date.now() - startTime;
  const isSeeded = !config.rpcUrl || config.rpcUrl.includes("YOUR_KEY");

  const manifest: PipelineManifest = {
    runAt: new Date().toISOString(),
    source: isSeeded ? "seed" : "live",
    chain: config.chain,
    poolAddress: config.poolAddress,
    blockRange: { from: config.fromBlock, to: config.toBlock },
    fileCounts: {
      raw: countFiles(config.paths.rawDir, ".json"),
      intermediate: countFiles(intDir, ".parquet"),
      processed: metricFileCount,
    },
    rowCounts: {
      swaps: swapCount,
      mints: mintCount,
      burns: burnCount,
      metricTables: metricFileCount,
    },
    durationMs,
  };

  mkdirSync(procDir, { recursive: true });
  writeFileSync(resolve(procDir, "pipeline-manifest.json"), JSON.stringify(manifest, null, 2));

  console.log("\n✔ Pipeline complete");
  console.log(`  Duration: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Source: ${manifest.source}`);
  console.log(`  Swaps: ${swapCount}, Mints: ${mintCount}, Burns: ${burnCount}`);
  console.log(`  Metric tables: ${metricFileCount}`);
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
