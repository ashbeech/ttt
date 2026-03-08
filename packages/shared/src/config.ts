import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "../../..");

export const config = {
  chain: "base" as const,
  chainId: Number(process.env.CHAIN_ID ?? 8453),
  poolAddress: (
    process.env.POOL_ADDRESS ??
    "0xd0b53D9277642d899DF5C87A3966A349A798F224"
  ).toLowerCase(),
  poolFeeTier: Number(process.env.POOL_FEE_TIER ?? 0.0005),
  rpcUrl: process.env.RPC_URL ?? "",
  fromBlock: process.env.FROM_BLOCK ? Number(process.env.FROM_BLOCK) : 43_041_220,
  toBlock: process.env.TO_BLOCK ? Number(process.env.TO_BLOCK) : 43_046_220,
  apiPort: Number(process.env.API_PORT ?? 3001),

  poolMeta: {
    name: "USDC / WETH 0.05%",
    token0: { symbol: "WETH", decimals: 18 },
    token1: { symbol: "USDC", decimals: 6 },
    feeTier: "0.05%",
    chain: "Base",
    dex: "Uniswap V3",
  },

  paths: {
    root: ROOT,
    rawDir: resolve(ROOT, "data/raw"),
    intermediateDir: resolve(ROOT, "data/intermediate"),
    processedDir: resolve(ROOT, "data/processed"),
    seedDir: resolve(ROOT, "data/seed"),
  },
};
