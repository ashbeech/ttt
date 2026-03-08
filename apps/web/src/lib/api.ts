const BASE = "/api";

async function fetchJson<T>(path: string): Promise<{ data: T; cache: { status: string; ttlSeconds: number } }> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function getOverview() {
  return fetchJson<{
    pool: { name: string; token0: { symbol: string }; token1: { symbol: string }; feeTier: string; chain: string; dex: string };
    blockRange: { from: number; to: number };
    lastPipelineRun: string | null;
    pipelineSource: string | null;
    latestMetrics: {
      feeEstimate: { day: string; fee_estimate: number; swap_count: number } | null;
      netLiquidity: { day: string; net_weth: number; net_usdc: number; weth_price_usdc: number; net_usd: number; weth_added: number; weth_removed: number; usdc_added: number; usdc_removed: number; mint_count: number; burn_count: number } | null;
      activeWallets: { day: string; active_total: number; active_swappers: number; active_liquidity_providers: number; active_both: number } | null;
    };
    dataFreshness: { manifestExists: boolean; rowCounts: { swaps: number; mints: number; burns: number } | null };
  }>("/overview");
}

export async function getFees(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return fetchJson<Array<{ day: string; fee_token: string; fee_estimate: number; swap_count: number; source_event_count: number }>>(
    `/metrics/fees${qs ? `?${qs}` : ""}`
  );
}

export async function getLiquidity(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return fetchJson<Array<{ day: string; weth_added: number; weth_removed: number; net_weth: number; usdc_added: number; usdc_removed: number; net_usdc: number; weth_price_usdc: number; net_usd: number; mint_count: number; burn_count: number }>>(
    `/metrics/liquidity${qs ? `?${qs}` : ""}`
  );
}

export async function getActiveWallets(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return fetchJson<Array<{ day: string; active_swappers: number; active_liquidity_providers: number; active_both: number; active_total: number }>>(
    `/metrics/active-wallets${qs ? `?${qs}` : ""}`
  );
}

export async function getSupporting(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return fetchJson<{
    swapCount: Array<{ day: string; swap_count: number }>;
    volumeProxy: Array<{ day: string; volume_token0: number; swap_count: number }>;
  }>(`/metrics/supporting${qs ? `?${qs}` : ""}`);
}

export async function getTopWallets(limit = 50) {
  return fetchJson<Array<{ address: string; role: string; swap_count: number; mint_count: number; burn_count: number; total_interactions: number }>>(
    `/wallets/top?limit=${limit}`
  );
}

export async function getLineageList() {
  return fetchJson<Array<{ key: string; metricName: string; description: string; formula: string; sourceEvents: string[] }>>("/lineage");
}

export async function getLineageDetail(metricName: string) {
  return fetchJson<{
    metricName: string;
    description: string;
    formula: string;
    sourceEvents: string[];
    sourceRawFiles: string[];
    sourceIntermediateFiles: string[];
    sampleNormalizedRows: Record<string, unknown>[];
    sampleRawLogs: Record<string, unknown>[];
  }>(`/lineage/${metricName}`);
}
