/**
 * Fetches live data from an RPC node and saves it as seed data.
 * Run this once with a valid RPC_URL to generate the committed seed dataset.
 * Usage: RPC_URL=https://site1.moralis-nodes.com/base/YOUR_KEY bun run scripts/seed-from-live.ts
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve } from "path";
import { config } from "@mini-terminal/shared";

async function main() {
  if (!config.rpcUrl || config.rpcUrl.includes("YOUR_KEY")) {
    console.error("Set RPC_URL to generate seed data from live source.");
    process.exit(1);
  }

  // Run ingestion with live data
  console.log("Fetching live data for seeding...");
  const proc = Bun.spawn(["bun", "run", "packages/ingestion/src/fetch-pool-events.ts"], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env },
  });

  const code = await proc.exited;
  if (code !== 0) throw new Error("Ingestion failed");

  // Copy raw files to seed directory
  const seedDir = config.paths.seedDir;
  const rawDir = config.paths.rawDir;
  mkdirSync(seedDir, { recursive: true });

  for (const file of readdirSync(rawDir)) {
    if (file.endsWith(".json")) {
      copyFileSync(resolve(rawDir, file), resolve(seedDir, file));
      console.log(`Copied ${file} to seed/`);
    }
  }

  console.log("\nSeed data generated. These files should be committed to the repo.");
}

main().catch((err) => {
  console.error("Seed generation failed:", err);
  process.exit(1);
});
