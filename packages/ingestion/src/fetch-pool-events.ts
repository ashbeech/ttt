import { createPublicClient, http, parseAbiItem, type Log } from "viem";
import { base } from "viem/chains";
import { writeFileSync, readFileSync, mkdirSync, existsSync, copyFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { config, UNISWAP_V3_POOL_ABI, sleep } from "@mini-terminal/shared";
import type { RawLogPayload, BlockTimestampPayload, RawLog } from "@mini-terminal/shared";

const EVENTS = [
  {
    name: "Swap" as const,
    signature: "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
  },
  {
    name: "Mint" as const,
    signature: "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
  },
  {
    name: "Burn" as const,
    signature: "event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
  },
];

const BATCH_SIZE = 100n;

function useSeedData(): boolean {
  if (!config.rpcUrl || config.rpcUrl.includes("YOUR_KEY")) {
    console.log("No RPC URL configured — using seeded data.");
    return true;
  }
  return false;
}

function copySeedData(): void {
  const seedDir = config.paths.seedDir;
  const rawDir = config.paths.rawDir;

  if (!existsSync(seedDir)) {
    throw new Error(
      `Seed data not found at ${seedDir}. Run 'bun run pipeline:seed' with an RPC_URL set first.`
    );
  }

  mkdirSync(rawDir, { recursive: true });

  for (const file of readdirSync(seedDir)) {
    if (file.endsWith(".json")) {
      copyFileSync(resolve(seedDir, file), resolve(rawDir, file));
    }
  }
  console.log("Copied seed data to data/raw/");
}

async function retryRpc<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const is429 = err?.status === 429 || err?.details === "Too Many Requests";
      if (is429 && attempt < maxRetries - 1) {
        const backoff = Math.min(2000 * 2 ** attempt, 30000);
        console.log(`  Rate limited, backing off ${backoff}ms (attempt ${attempt + 1}/${maxRetries})...`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries reached");
}

async function fetchLiveLogs(): Promise<void> {
  const client = createPublicClient({
    chain: base,
    transport: http(config.rpcUrl),
  });

  const fromBlock = BigInt(config.fromBlock);
  const toBlock = BigInt(config.toBlock);
  const poolAddress = config.poolAddress as `0x${string}`;
  const rawDir = config.paths.rawDir;

  mkdirSync(rawDir, { recursive: true });

  const uniqueBlocks = new Set<bigint>();

  // Check if event logs already exist on disk (resume support)
  let logFilesExist = true;
  for (const event of EVENTS) {
    const filename = `logs.${event.name.toLowerCase()}.json`;
    if (!existsSync(resolve(rawDir, filename))) {
      logFilesExist = false;
      break;
    }
  }

  if (logFilesExist && !existsSync(resolve(rawDir, "blocks.json"))) {
    console.log("Event log files already exist — resuming from timestamp fetch...");
    for (const event of EVENTS) {
      const filename = `logs.${event.name.toLowerCase()}.json`;
      const payload: RawLogPayload = JSON.parse(readFileSync(resolve(rawDir, filename), "utf-8"));
      for (const log of payload.logs) {
        uniqueBlocks.add(BigInt(log.blockNumber));
      }
    }
  } else if (!logFilesExist) {
    for (const event of EVENTS) {
      console.log(`Fetching ${event.name} events...`);
      const allLogs: RawLog[] = [];

      let cursor = fromBlock;
      while (cursor <= toBlock) {
        const batchEnd = cursor + BATCH_SIZE - 1n > toBlock ? toBlock : cursor + BATCH_SIZE - 1n;

        const logs = await retryRpc(() =>
          client.getLogs({
            address: poolAddress,
            event: parseAbiItem(event.signature),
            fromBlock: cursor,
            toBlock: batchEnd,
          })
        );

        for (const log of logs) {
          uniqueBlocks.add(log.blockNumber);
          allLogs.push({
            address: log.address,
            blockNumber: `0x${log.blockNumber.toString(16)}`,
            transactionHash: log.transactionHash,
            logIndex: `0x${log.logIndex.toString(16)}`,
            data: log.data,
            topics: [...log.topics],
          });
        }

        cursor = batchEnd + 1n;
        await sleep(300);
      }

      const payload: RawLogPayload = {
        chain: config.chain,
        poolAddress: config.poolAddress,
        eventName: event.name,
        fromBlock: config.fromBlock,
        toBlock: config.toBlock,
        fetchedAt: new Date().toISOString(),
        logs: allLogs,
      };

      const filename = `logs.${event.name.toLowerCase()}.json`;
      writeFileSync(resolve(rawDir, filename), JSON.stringify(payload, null, 2));
      console.log(`  Wrote ${allLogs.length} ${event.name} logs to ${filename}`);
    }
  } else {
    console.log("All raw data files already exist — skipping fetch.");
    return;
  }

  // Interpolate block timestamps from boundary blocks (only 2 RPC calls).
  // Base has consistent ~2s block times, so linear interpolation is very accurate.
  console.log(`Deriving timestamps for ${uniqueBlocks.size} unique blocks via interpolation...`);
  const blockTimestamps: Record<string, number> = {};

  const blockArray = Array.from(uniqueBlocks).sort();
  const minBlock = blockArray[0];
  const maxBlock = blockArray[blockArray.length - 1];

  await sleep(2000);
  const startBlock = await retryRpc(() => client.getBlock({ blockNumber: minBlock }));
  await sleep(1000);
  const endBlock = await retryRpc(() => client.getBlock({ blockNumber: maxBlock }));

  const startTs = Number(startBlock.timestamp);
  const endTs = Number(endBlock.timestamp);
  const blockSpan = Number(maxBlock - minBlock);
  const secsPerBlock = blockSpan > 0 ? (endTs - startTs) / blockSpan : 2;

  console.log(`  Block range: ${minBlock}-${maxBlock}, time span: ${endTs - startTs}s, ~${secsPerBlock.toFixed(2)}s/block`);

  for (const bn of blockArray) {
    const offset = Number(bn - minBlock);
    blockTimestamps[`0x${bn.toString(16)}`] = Math.round(startTs + offset * secsPerBlock);
  }

  const tsPayload: BlockTimestampPayload = {
    chain: config.chain,
    fetchedAt: new Date().toISOString(),
    blocks: blockTimestamps,
  };

  writeFileSync(resolve(rawDir, "blocks.json"), JSON.stringify(tsPayload, null, 2));
  console.log(`  Wrote ${Object.keys(blockTimestamps).length} block timestamps`);
}

async function main() {
  console.log("=== Ingestion ===");
  console.log(`Pool: ${config.poolMeta.name} on ${config.poolMeta.chain}`);
  console.log(`Block range: ${config.fromBlock} - ${config.toBlock}`);

  if (useSeedData()) {
    copySeedData();
  } else {
    await fetchLiveLogs();
  }

  console.log("Ingestion complete.\n");
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
