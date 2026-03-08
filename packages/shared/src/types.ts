// ── Raw log shape from RPC ──────────────────────────────────────────
export interface RawLogPayload {
  chain: string;
  poolAddress: string;
  eventName: "Swap" | "Mint" | "Burn";
  fromBlock: number;
  toBlock: number;
  fetchedAt: string;
  logs: RawLog[];
}

export interface RawLog {
  address: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  data: string;
  topics: string[];
}

// ── Block timestamp map ─────────────────────────────────────────────
export interface BlockTimestampPayload {
  chain: string;
  fetchedAt: string;
  blocks: Record<string, number>; // hex block number -> unix timestamp
}

// ── Normalized event rows ───────────────────────────────────────────
export interface NormalizedSwap {
  chain: string;
  pool_address: string;
  block_number: number;
  tx_hash: string;
  log_index: number;
  timestamp: number;
  day: string;
  sender: string;
  recipient: string;
  amount0: string;
  amount1: string;
  sqrt_price_x96: string;
  liquidity: string;
  tick: number;
}

export interface NormalizedMint {
  chain: string;
  pool_address: string;
  block_number: number;
  tx_hash: string;
  log_index: number;
  timestamp: number;
  day: string;
  sender: string;
  owner: string;
  tick_lower: number;
  tick_upper: number;
  amount: string;
  amount0: string;
  amount1: string;
}

export interface NormalizedBurn {
  chain: string;
  pool_address: string;
  block_number: number;
  tx_hash: string;
  log_index: number;
  timestamp: number;
  day: string;
  owner: string;
  tick_lower: number;
  tick_upper: number;
  amount: string;
  amount0: string;
  amount1: string;
}

// ── Metric row types ────────────────────────────────────────────────
export interface DailyFeeEstimate {
  day: string;
  fee_token: string;
  fee_estimate: number;
  swap_count: number;
  source_event_count: number;
}

export interface DailyNetLiquidity {
  day: string;
  weth_added: number;
  weth_removed: number;
  net_weth: number;
  usdc_added: number;
  usdc_removed: number;
  net_usdc: number;
  mint_count: number;
  burn_count: number;
}

export interface DailyActiveWallets {
  day: string;
  active_swappers: number;
  active_liquidity_providers: number;
  active_both: number;
  active_total: number;
}

export interface DailySwapCount {
  day: string;
  swap_count: number;
}

export interface DailyVolumeProxy {
  day: string;
  volume_token0: number;
  swap_count: number;
}

export interface TopWallet {
  address: string;
  role: "swapper" | "liquidity_provider" | "both";
  swap_count: number;
  mint_count: number;
  burn_count: number;
  total_interactions: number;
}

// ── Pipeline manifest ───────────────────────────────────────────────
export interface PipelineManifest {
  runAt: string;
  source: "live" | "seed";
  chain: string;
  poolAddress: string;
  blockRange: { from: number; to: number };
  fileCounts: { raw: number; intermediate: number; processed: number };
  rowCounts: {
    swaps: number;
    mints: number;
    burns: number;
    metricTables: number;
  };
  durationMs: number;
}

// ── API response wrappers ───────────────────────────────────────────
export interface CacheMeta {
  status: "hit" | "miss";
  ttlSeconds: number;
}

export interface ApiResponse<T> {
  data: T;
  cache: CacheMeta;
  meta?: Record<string, unknown>;
}

// ── Lineage ─────────────────────────────────────────────────────────
export interface MetricLineage {
  metricName: string;
  description: string;
  formula: string;
  sourceEvents: string[];
  sourceRawFiles: string[];
  sourceIntermediateFiles: string[];
  sampleNormalizedRows: Record<string, unknown>[];
  sampleRawLogs: Record<string, unknown>[];
}
