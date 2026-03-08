export function unixToDay(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function hexToNumber(hex: string): number {
  return Number(hex);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function formatTokenAmount(raw: string | bigint, decimals: number): number {
  const value = typeof raw === "string" ? BigInt(raw) : raw;
  const abs = value < 0n ? -value : value;
  return Number(abs) / 10 ** decimals;
}

export function absFormatTokenAmount(raw: string | bigint, decimals: number): number {
  const value = typeof raw === "string" ? BigInt(raw) : raw;
  const abs = value < 0n ? -value : value;
  return Number(abs) / 10 ** decimals;
}
