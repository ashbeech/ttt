import { describe, test, expect, beforeAll } from "bun:test";
import { existsSync } from "fs";
import { resolve } from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { config } from "@mini-terminal/shared";

const procDir = config.paths.processedDir;
const intDir = config.paths.intermediateDir;

async function queryParquet<T = Record<string, unknown>>(path: string, sql?: string): Promise<T[]> {
  const inst = await DuckDBInstance.create(":memory:");
  const conn = await inst.connect();
  const query = sql ?? `SELECT * FROM read_parquet('${path}')`;
  const reader = await conn.runAndReadAll(query);
  const cols = reader.columnNames();
  return reader.getRows().map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) {
      const val = row[i];
      if (val && typeof val === "object" && "days" in val) {
        obj[cols[i]] = new Date((val as { days: number }).days * 86400000).toISOString().slice(0, 10);
      } else {
        obj[cols[i]] = typeof val === "bigint" ? Number(val) : val;
      }
    }
    return obj as T;
  });
}

describe("Pipeline output exists", () => {
  test("intermediate parquet files exist", () => {
    expect(existsSync(resolve(intDir, "swaps.parquet"))).toBe(true);
    expect(existsSync(resolve(intDir, "mints.parquet"))).toBe(true);
    expect(existsSync(resolve(intDir, "burns.parquet"))).toBe(true);
  });

  test("processed metric parquet files exist", () => {
    const expected = [
      "daily_fee_estimate.parquet",
      "daily_net_liquidity.parquet",
      "daily_active_wallets.parquet",
      "daily_swap_count.parquet",
      "daily_volume_proxy.parquet",
      "top_wallets.parquet",
    ];
    for (const file of expected) {
      expect(existsSync(resolve(procDir, file))).toBe(true);
    }
  });

  test("pipeline manifest exists", () => {
    expect(existsSync(resolve(procDir, "pipeline-manifest.json"))).toBe(true);
  });
});

describe("Normalized event tables", () => {
  test("swaps have expected columns", async () => {
    const rows = await queryParquet(resolve(intDir, "swaps.parquet"));
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0] as Record<string, unknown>;
    expect(first).toHaveProperty("chain");
    expect(first).toHaveProperty("pool_address");
    expect(first).toHaveProperty("block_number");
    expect(first).toHaveProperty("tx_hash");
    expect(first).toHaveProperty("day");
    expect(first).toHaveProperty("sender");
    expect(first).toHaveProperty("amount0");
    expect(first).toHaveProperty("amount1");
    expect(first).toHaveProperty("tick");
  });

  test("mints have expected columns", async () => {
    const rows = await queryParquet(resolve(intDir, "mints.parquet"));
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0] as Record<string, unknown>;
    expect(first).toHaveProperty("owner");
    expect(first).toHaveProperty("tick_lower");
    expect(first).toHaveProperty("tick_upper");
    expect(first).toHaveProperty("amount");
  });

  test("burns have expected columns", async () => {
    const rows = await queryParquet(resolve(intDir, "burns.parquet"));
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0] as Record<string, unknown>;
    expect(first).toHaveProperty("owner");
    expect(first).toHaveProperty("amount");
  });
});

describe("Daily fee estimate", () => {
  test("has at least one row", async () => {
    const rows = await queryParquet(resolve(procDir, "daily_fee_estimate.parquet"));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  test("fee_estimate is positive", async () => {
    const rows = await queryParquet<{ fee_estimate: number }>(
      resolve(procDir, "daily_fee_estimate.parquet")
    );
    for (const row of rows) {
      expect(row.fee_estimate).toBeGreaterThan(0);
    }
  });

  test("swap_count matches normalized swaps per day", async () => {
    const swapsPath = resolve(intDir, "swaps.parquet");
    const feePath = resolve(procDir, "daily_fee_estimate.parquet");

    const inst = await DuckDBInstance.create(":memory:");
    const conn = await inst.connect();

    const swapReader = await conn.runAndReadAll(
      `SELECT COUNT(*) AS total FROM read_parquet('${swapsPath}')`
    );
    const totalSwaps = Number(swapReader.getRows()[0][0]);

    const feeReader = await conn.runAndReadAll(
      `SELECT SUM(swap_count) AS total FROM read_parquet('${feePath}')`
    );
    const feeSwapTotal = Number(feeReader.getRows()[0][0]);

    expect(feeSwapTotal).toBe(totalSwaps);
  });

  test("fee estimate equals abs(amount0) / 10^18 * 0.0005 per day", async () => {
    const swapsPath = resolve(intDir, "swaps.parquet");
    const feePath = resolve(procDir, "daily_fee_estimate.parquet");

    const inst = await DuckDBInstance.create(":memory:");
    const conn = await inst.connect();

    const manualReader = await conn.runAndReadAll(`
      SELECT day, SUM(ABS(CAST(amount0 AS DOUBLE)) / POW(10, 18) * 0.0005) AS expected_fee
      FROM read_parquet('${swapsPath}')
      GROUP BY day
      ORDER BY day
    `);
    const manual = manualReader.getRows();

    const actualReader = await conn.runAndReadAll(`
      SELECT day, fee_estimate FROM read_parquet('${feePath}') ORDER BY day
    `);
    const actual = actualReader.getRows();

    expect(actual.length).toBe(manual.length);
    for (let i = 0; i < actual.length; i++) {
      const expectedFee = Number(manual[i][1]);
      const actualFee = Number(actual[i][1]);
      expect(Math.abs(actualFee - expectedFee)).toBeLessThan(0.000001);
    }
  });
});

describe("Daily net liquidity", () => {
  test("net_weth = weth_added - weth_removed", async () => {
    const rows = await queryParquet<{
      weth_added: number;
      weth_removed: number;
      net_weth: number;
    }>(resolve(procDir, "daily_net_liquidity.parquet"));

    for (const row of rows) {
      expect(Math.abs(row.net_weth - (row.weth_added - row.weth_removed))).toBeLessThan(0.000001);
    }
  });

  test("net_usdc = usdc_added - usdc_removed", async () => {
    const rows = await queryParquet<{
      usdc_added: number;
      usdc_removed: number;
      net_usdc: number;
    }>(resolve(procDir, "daily_net_liquidity.parquet"));

    for (const row of rows) {
      expect(Math.abs(row.net_usdc - (row.usdc_added - row.usdc_removed))).toBeLessThan(0.01);
    }
  });

  test("mint_count and burn_count are non-negative", async () => {
    const rows = await queryParquet<{ mint_count: number; burn_count: number }>(
      resolve(procDir, "daily_net_liquidity.parquet")
    );
    for (const row of rows) {
      expect(row.mint_count).toBeGreaterThanOrEqual(0);
      expect(row.burn_count).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Daily active wallets", () => {
  test("active_total >= active_swappers + active_lps + active_both", async () => {
    const rows = await queryParquet<{
      active_swappers: number;
      active_liquidity_providers: number;
      active_both: number;
      active_total: number;
    }>(resolve(procDir, "daily_active_wallets.parquet"));

    for (const row of rows) {
      const sum = row.active_swappers + row.active_liquidity_providers + row.active_both;
      expect(row.active_total).toBe(sum);
    }
  });
});

describe("Top wallets", () => {
  test("total_interactions = swap_count + mint_count + burn_count", async () => {
    const rows = await queryParquet<{
      swap_count: number;
      mint_count: number;
      burn_count: number;
      total_interactions: number;
    }>(resolve(procDir, "top_wallets.parquet"));

    for (const row of rows) {
      expect(row.total_interactions).toBe(row.swap_count + row.mint_count + row.burn_count);
    }
  });

  test("role classification is correct", async () => {
    const rows = await queryParquet<{
      role: string;
      swap_count: number;
      mint_count: number;
      burn_count: number;
    }>(resolve(procDir, "top_wallets.parquet"));

    for (const row of rows) {
      const hasSwaps = row.swap_count > 0;
      const hasLp = row.mint_count > 0 || row.burn_count > 0;

      if (hasSwaps && hasLp) expect(row.role).toBe("both");
      else if (hasSwaps) expect(row.role).toBe("swapper");
      else expect(row.role).toBe("liquidity_provider");
    }
  });

  test("rows are sorted by total_interactions descending", async () => {
    const rows = await queryParquet<{ total_interactions: number }>(
      resolve(procDir, "top_wallets.parquet")
    );

    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].total_interactions).toBeLessThanOrEqual(rows[i - 1].total_interactions);
    }
  });
});

describe("Cache", () => {
  test("TtlCache works correctly", async () => {
    const { TtlCache } = await import("@mini-terminal/shared");
    const cache = new TtlCache();

    cache.set("test", { value: 42 }, 1);
    const hit = cache.get("test");
    expect(hit.hit).toBe(true);
    if (hit.hit) expect(hit.value).toEqual({ value: 42 });

    const miss = cache.get("nonexistent");
    expect(miss.hit).toBe(false);
  });
});
