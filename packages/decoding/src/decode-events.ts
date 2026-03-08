import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { decodeEventLog } from "viem";
import { config, UNISWAP_V3_POOL_ABI, unixToDay } from "@mini-terminal/shared";
import type {
  RawLogPayload,
  BlockTimestampPayload,
  NormalizedSwap,
  NormalizedMint,
  NormalizedBurn,
} from "@mini-terminal/shared";
import { DuckDBInstance } from "@duckdb/node-api";

function loadRawFile<T>(filename: string): T {
  const filePath = resolve(config.paths.rawDir, filename);
  if (!existsSync(filePath)) {
    throw new Error(`Raw file not found: ${filePath}`);
  }
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function loadBlockTimestamps(): Record<string, number> {
  const payload = loadRawFile<BlockTimestampPayload>("blocks.json");
  return payload.blocks;
}

async function writeJsonAndParquet(
  conn: Awaited<ReturnType<Awaited<ReturnType<typeof DuckDBInstance.create>>["connect"]>>,
  tableName: string,
  rows: Record<string, unknown>[],
  outDir: string
): Promise<number> {
  if (rows.length === 0) {
    console.log(`  No rows for ${tableName}, skipping.`);
    return 0;
  }

  // Write as temporary JSON, then use DuckDB to convert to Parquet
  const jsonPath = resolve(outDir, `${tableName}.json`);
  const parquetPath = resolve(outDir, `${tableName}.parquet`);

  writeFileSync(jsonPath, JSON.stringify(rows));

  await conn.run(`
    COPY (SELECT * FROM read_json_auto('${jsonPath}'))
    TO '${parquetPath}' (FORMAT PARQUET)
  `);

  // Clean up temp JSON
  const { unlinkSync } = await import("fs");
  try { unlinkSync(jsonPath); } catch {}

  return rows.length;
}

function decodeSwaps(swapPayload: RawLogPayload, timestamps: Record<string, number>): NormalizedSwap[] {
  const results: NormalizedSwap[] = [];

  for (const log of swapPayload.logs) {
    try {
      const decoded = decodeEventLog({
        abi: UNISWAP_V3_POOL_ABI,
        data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });

      if (decoded.eventName !== "Swap") continue;
      const args = decoded.args as {
        sender: string;
        recipient: string;
        amount0: bigint;
        amount1: bigint;
        sqrtPriceX96: bigint;
        liquidity: bigint;
        tick: number;
      };

      const blockNum = Number(log.blockNumber);
      const ts = timestamps[log.blockNumber] ?? 0;

      results.push({
        chain: config.chain,
        pool_address: config.poolAddress,
        block_number: blockNum,
        tx_hash: log.transactionHash,
        log_index: Number(log.logIndex),
        timestamp: ts,
        day: unixToDay(ts),
        sender: args.sender.toLowerCase(),
        recipient: args.recipient.toLowerCase(),
        amount0: args.amount0.toString(),
        amount1: args.amount1.toString(),
        sqrt_price_x96: args.sqrtPriceX96.toString(),
        liquidity: args.liquidity.toString(),
        tick: args.tick,
      });
    } catch (e) {
      // Silently skip non-matching events
    }
  }
  return results;
}

function decodeMints(mintPayload: RawLogPayload, timestamps: Record<string, number>): NormalizedMint[] {
  const results: NormalizedMint[] = [];

  for (const log of mintPayload.logs) {
    try {
      const decoded = decodeEventLog({
        abi: UNISWAP_V3_POOL_ABI,
        data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });

      if (decoded.eventName !== "Mint") continue;
      const args = decoded.args as {
        sender: string;
        owner: string;
        tickLower: number;
        tickUpper: number;
        amount: bigint;
        amount0: bigint;
        amount1: bigint;
      };

      const blockNum = Number(log.blockNumber);
      const ts = timestamps[log.blockNumber] ?? 0;

      results.push({
        chain: config.chain,
        pool_address: config.poolAddress,
        block_number: blockNum,
        tx_hash: log.transactionHash,
        log_index: Number(log.logIndex),
        timestamp: ts,
        day: unixToDay(ts),
        sender: args.sender.toLowerCase(),
        owner: args.owner.toLowerCase(),
        tick_lower: args.tickLower,
        tick_upper: args.tickUpper,
        amount: args.amount.toString(),
        amount0: args.amount0.toString(),
        amount1: args.amount1.toString(),
      });
    } catch (e) {
      // Silently skip non-matching events
    }
  }
  return results;
}

function decodeBurns(burnPayload: RawLogPayload, timestamps: Record<string, number>): NormalizedBurn[] {
  const results: NormalizedBurn[] = [];

  for (const log of burnPayload.logs) {
    try {
      const decoded = decodeEventLog({
        abi: UNISWAP_V3_POOL_ABI,
        data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });

      if (decoded.eventName !== "Burn") continue;
      const args = decoded.args as {
        owner: string;
        tickLower: number;
        tickUpper: number;
        amount: bigint;
        amount0: bigint;
        amount1: bigint;
      };

      const blockNum = Number(log.blockNumber);
      const ts = timestamps[log.blockNumber] ?? 0;

      results.push({
        chain: config.chain,
        pool_address: config.poolAddress,
        block_number: blockNum,
        tx_hash: log.transactionHash,
        log_index: Number(log.logIndex),
        timestamp: ts,
        day: unixToDay(ts),
        owner: args.owner.toLowerCase(),
        tick_lower: args.tickLower,
        tick_upper: args.tickUpper,
        amount: args.amount.toString(),
        amount0: args.amount0.toString(),
        amount1: args.amount1.toString(),
      });
    } catch (e) {
      // Silently skip non-matching events
    }
  }
  return results;
}

async function main() {
  console.log("=== Decoding ===");

  const swapPayload = loadRawFile<RawLogPayload>("logs.swap.json");
  const mintPayload = loadRawFile<RawLogPayload>("logs.mint.json");
  const burnPayload = loadRawFile<RawLogPayload>("logs.burn.json");
  const timestamps = loadBlockTimestamps();

  console.log(`Loaded ${swapPayload.logs.length} swap, ${mintPayload.logs.length} mint, ${burnPayload.logs.length} burn raw logs`);

  const swaps = decodeSwaps(swapPayload, timestamps);
  const mints = decodeMints(mintPayload, timestamps);
  const burns = decodeBurns(burnPayload, timestamps);

  console.log(`Decoded ${swaps.length} swaps, ${mints.length} mints, ${burns.length} burns`);

  const outDir = config.paths.intermediateDir;
  mkdirSync(outDir, { recursive: true });

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();

  const swapCount = await writeJsonAndParquet(conn, "swaps", swaps as unknown as Record<string, unknown>[], outDir);
  const mintCount = await writeJsonAndParquet(conn, "mints", mints as unknown as Record<string, unknown>[], outDir);
  const burnCount = await writeJsonAndParquet(conn, "burns", burns as unknown as Record<string, unknown>[], outDir);

  console.log(`Wrote ${swapCount} swaps, ${mintCount} mints, ${burnCount} burns to parquet`);
  console.log("Decoding complete.\n");
}

main().catch((err) => {
  console.error("Decoding failed:", err);
  process.exit(1);
});
