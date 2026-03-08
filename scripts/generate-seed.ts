/**
 * Generates realistic-looking seed data for the demo.
 * This creates deterministic sample data so the pipeline works out of the box
 * without an RPC key. The data structure exactly matches real RPC responses.
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { encodeAbiParameters, keccak256, toHex, toBytes } from "viem";

const SEED_DIR = resolve(import.meta.dirname, "../data/seed");
mkdirSync(SEED_DIR, { recursive: true });

const POOL = "0xd0b53d9277642d899df5c87a3966a349a798f224";
const CHAIN = "base";
const FROM_BLOCK = 26_600_000;
const TO_BLOCK = 26_650_000;

// Deterministic pseudo-random using a simple LCG
let rngState = 42;
function rand(): number {
  rngState = (rngState * 1664525 + 1013904223) & 0x7fffffff;
  return rngState / 0x7fffffff;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function randAddress(): string {
  let addr = "0x";
  for (let i = 0; i < 40; i++) {
    addr += "0123456789abcdef"[randInt(0, 15)];
  }
  return addr;
}

function randBigIntStr(min: bigint, max: bigint): string {
  const range = max - min;
  const r = BigInt(Math.floor(rand() * Number(range)));
  return (min + r).toString();
}

// Generate a pool of ~30 wallets that interact repeatedly
const WALLET_POOL = Array.from({ length: 30 }, () => randAddress());
const LP_WALLETS = WALLET_POOL.slice(0, 8);
const SWAP_WALLETS = WALLET_POOL.slice(5, 25);
const ROUTER_ADDRESSES = [randAddress(), randAddress()];

// Event signatures (topic0) — must match the ABI definition exactly
const SWAP_TOPIC = keccak256(toBytes("Swap(address,address,int256,int256,uint160,uint128,int24)"));
const MINT_TOPIC = keccak256(toBytes("Mint(address,address,int24,int24,uint128,uint256,uint256)"));
const BURN_TOPIC = keccak256(toBytes("Burn(address,int24,int24,uint128,uint256,uint256)"));

// Spread events across ~5 days of blocks
const BLOCKS_PER_DAY = 10_000;
const BASE_TIMESTAMP = 1740787200; // ~2025-02-28T00:00:00Z as a reasonable start

interface RawLog {
  address: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  data: string;
  topics: string[];
}

const blockTimestamps: Record<string, number> = {};
const swapLogs: RawLog[] = [];
const mintLogs: RawLog[] = [];
const burnLogs: RawLog[] = [];

function blockToTimestamp(blockNum: number): number {
  const dayOffset = Math.floor((blockNum - FROM_BLOCK) / BLOCKS_PER_DAY);
  const intraDay = ((blockNum - FROM_BLOCK) % BLOCKS_PER_DAY) * 2;
  return BASE_TIMESTAMP + dayOffset * 86400 + intraDay;
}

function padHex(val: string | number | bigint, bytes: number): string {
  let hex = typeof val === "string" ? val : BigInt(val).toString(16);
  if (hex.startsWith("-")) {
    // Two's complement for negative int256
    const abs = BigInt(val) < 0n ? -BigInt(val) : BigInt(val);
    const twos = (1n << BigInt(bytes * 8)) - abs;
    hex = twos.toString(16);
  }
  return hex.padStart(bytes * 2, "0");
}

function toTopic(addr: string): string {
  return "0x" + "0".repeat(24) + addr.slice(2).toLowerCase();
}

function toInt24Topic(val: number): string {
  if (val < 0) {
    const twos = (1n << 256n) + BigInt(val);
    return "0x" + twos.toString(16).padStart(64, "0");
  }
  return "0x" + padHex(val, 32);
}

// Generate swap events (~150-250 per day, 5 days)
for (let day = 0; day < 5; day++) {
  const daySwapCount = randInt(150, 250);
  for (let i = 0; i < daySwapCount; i++) {
    const blockNum = FROM_BLOCK + day * BLOCKS_PER_DAY + randInt(0, BLOCKS_PER_DAY - 1);
    const hexBlock = "0x" + blockNum.toString(16);
    const ts = blockToTimestamp(blockNum);
    blockTimestamps[hexBlock] = ts;

    const sender = SWAP_WALLETS[randInt(0, SWAP_WALLETS.length - 1)];
    const recipient = ROUTER_ADDRESSES[randInt(0, 1)];

    // amount0 and amount1 — one negative, one positive (token directions)
    const amount0Raw = BigInt(randBigIntStr(1n * 10n ** 14n, 5n * 10n ** 18n));
    const isNeg0 = rand() > 0.5;
    const amount0 = isNeg0 ? -amount0Raw : amount0Raw;
    const amount1 = isNeg0
      ? BigInt(randBigIntStr(500n * 10n ** 6n, 15000n * 10n ** 6n))
      : -BigInt(randBigIntStr(500n * 10n ** 6n, 15000n * 10n ** 6n));

    const sqrtPriceX96 = BigInt(randBigIntStr(1n * 10n ** 27n, 5n * 10n ** 28n));
    const liquidity = BigInt(randBigIntStr(1n * 10n ** 18n, 1n * 10n ** 22n));
    const tick = randInt(-200000, 200000);

    const data = encodeAbiParameters(
      [
        { type: "int256" },
        { type: "int256" },
        { type: "uint160" },
        { type: "uint128" },
        { type: "int24" },
      ],
      [amount0, amount1, sqrtPriceX96, liquidity, tick]
    );

    const txHash = "0x" + padHex(BigInt(blockNum * 1000 + i), 32);

    swapLogs.push({
      address: POOL,
      blockNumber: hexBlock,
      transactionHash: txHash,
      logIndex: "0x" + i.toString(16),
      data,
      topics: [SWAP_TOPIC, toTopic(sender), toTopic(recipient)],
    });
  }
}

// Generate mint events (~10-30 per day)
for (let day = 0; day < 5; day++) {
  const dayMintCount = randInt(10, 30);
  for (let i = 0; i < dayMintCount; i++) {
    const blockNum = FROM_BLOCK + day * BLOCKS_PER_DAY + randInt(0, BLOCKS_PER_DAY - 1);
    const hexBlock = "0x" + blockNum.toString(16);
    const ts = blockToTimestamp(blockNum);
    blockTimestamps[hexBlock] = ts;

    const sender = LP_WALLETS[randInt(0, LP_WALLETS.length - 1)];
    const owner = LP_WALLETS[randInt(0, LP_WALLETS.length - 1)];
    const tickLower = randInt(-100000, 0);
    const tickUpper = randInt(0, 100000);
    const amount = BigInt(randBigIntStr(1n * 10n ** 15n, 1n * 10n ** 20n));
    const amount0 = BigInt(randBigIntStr(1n * 10n ** 14n, 2n * 10n ** 18n));
    const amount1 = BigInt(randBigIntStr(100n * 10n ** 6n, 5000n * 10n ** 6n));

    const data = encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint128" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [sender as `0x${string}`, amount, amount0, amount1]
    );

    const txHash = "0x" + padHex(BigInt(blockNum * 1000 + 500 + i), 32);

    mintLogs.push({
      address: POOL,
      blockNumber: hexBlock,
      transactionHash: txHash,
      logIndex: "0x" + i.toString(16),
      data,
      topics: [MINT_TOPIC, toTopic(owner), toInt24Topic(tickLower), toInt24Topic(tickUpper)],
    });
  }
}

// Generate burn events (~5-15 per day)
for (let day = 0; day < 5; day++) {
  const dayBurnCount = randInt(5, 15);
  for (let i = 0; i < dayBurnCount; i++) {
    const blockNum = FROM_BLOCK + day * BLOCKS_PER_DAY + randInt(0, BLOCKS_PER_DAY - 1);
    const hexBlock = "0x" + blockNum.toString(16);
    const ts = blockToTimestamp(blockNum);
    blockTimestamps[hexBlock] = ts;

    const owner = LP_WALLETS[randInt(0, LP_WALLETS.length - 1)];
    const tickLower = randInt(-100000, 0);
    const tickUpper = randInt(0, 100000);
    const amount = BigInt(randBigIntStr(1n * 10n ** 14n, 5n * 10n ** 19n));
    const amount0 = BigInt(randBigIntStr(1n * 10n ** 13n, 1n * 10n ** 18n));
    const amount1 = BigInt(randBigIntStr(50n * 10n ** 6n, 3000n * 10n ** 6n));

    const data = encodeAbiParameters(
      [
        { type: "uint128" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [amount, amount0, amount1]
    );

    const txHash = "0x" + padHex(BigInt(blockNum * 1000 + 800 + i), 32);

    burnLogs.push({
      address: POOL,
      blockNumber: hexBlock,
      transactionHash: txHash,
      logIndex: "0x" + i.toString(16),
      data,
      topics: [BURN_TOPIC, toTopic(owner), toInt24Topic(tickLower), toInt24Topic(tickUpper)],
    });
  }
}

// Write files
const now = new Date().toISOString();

writeFileSync(
  resolve(SEED_DIR, "logs.swap.json"),
  JSON.stringify(
    { chain: CHAIN, poolAddress: POOL, eventName: "Swap", fromBlock: FROM_BLOCK, toBlock: TO_BLOCK, fetchedAt: now, logs: swapLogs },
    null,
    2
  )
);

writeFileSync(
  resolve(SEED_DIR, "logs.mint.json"),
  JSON.stringify(
    { chain: CHAIN, poolAddress: POOL, eventName: "Mint", fromBlock: FROM_BLOCK, toBlock: TO_BLOCK, fetchedAt: now, logs: mintLogs },
    null,
    2
  )
);

writeFileSync(
  resolve(SEED_DIR, "logs.burn.json"),
  JSON.stringify(
    { chain: CHAIN, poolAddress: POOL, eventName: "Burn", fromBlock: FROM_BLOCK, toBlock: TO_BLOCK, fetchedAt: now, logs: burnLogs },
    null,
    2
  )
);

writeFileSync(
  resolve(SEED_DIR, "blocks.json"),
  JSON.stringify(
    { chain: CHAIN, fetchedAt: now, blocks: blockTimestamps },
    null,
    2
  )
);

console.log(`Generated seed data:`);
console.log(`  Swaps: ${swapLogs.length}`);
console.log(`  Mints: ${mintLogs.length}`);
console.log(`  Burns: ${burnLogs.length}`);
console.log(`  Blocks: ${Object.keys(blockTimestamps).length}`);
console.log(`  Files written to: ${SEED_DIR}`);
