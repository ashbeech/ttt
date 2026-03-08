import { mkdirSync } from "fs";
import { resolve } from "path";
import { config } from "@mini-terminal/shared";
import { DuckDBInstance } from "@duckdb/node-api";

async function main() {
  console.log("=== Metrics ===");

  const intDir = config.paths.intermediateDir;
  const outDir = config.paths.processedDir;
  mkdirSync(outDir, { recursive: true });

  const swapsPath = resolve(intDir, "swaps.parquet");
  const mintsPath = resolve(intDir, "mints.parquet");
  const burnsPath = resolve(intDir, "burns.parquet");

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();

  const feeTier = config.poolFeeTier;
  const token0Decimals = config.poolMeta.token0.decimals;

  // ── Daily fee estimate ──────────────────────────────────────────────
  console.log("Building daily_fee_estimate...");
  await conn.run(`
    COPY (
      SELECT
        day,
        '${config.poolMeta.token0.symbol}' AS fee_token,
        SUM(ABS(CAST(amount0 AS DOUBLE)) / POW(10, ${token0Decimals}) * ${feeTier}) AS fee_estimate,
        COUNT(*) AS swap_count,
        COUNT(*) AS source_event_count
      FROM read_parquet('${swapsPath}')
      GROUP BY day
      ORDER BY day
    ) TO '${resolve(outDir, "daily_fee_estimate.parquet")}' (FORMAT PARQUET)
  `);

  // ── Daily net liquidity (USD-equivalent) ───────────────────────────
  // Derive WETH price from the pool's own swap data, then convert
  // everything to a single USDC-denominated figure.
  const token1Decimals = config.poolMeta.token1.decimals;
  console.log("Building daily_net_liquidity...");
  await conn.run(`
    COPY (
      WITH swap_price AS (
        SELECT
          day,
          SUM(ABS(CAST(amount1 AS DOUBLE)) / POW(10, ${token1Decimals}))
            / NULLIF(SUM(ABS(CAST(amount0 AS DOUBLE)) / POW(10, ${token0Decimals})), 0)
            AS weth_price_usdc
        FROM read_parquet('${swapsPath}')
        GROUP BY day
      ),
      mints AS (
        SELECT day,
          SUM(ABS(CAST(amount0 AS DOUBLE)) / POW(10, ${token0Decimals})) AS weth_added,
          SUM(ABS(CAST(amount1 AS DOUBLE)) / POW(10, ${token1Decimals})) AS usdc_added,
          COUNT(*) AS mint_count
        FROM read_parquet('${mintsPath}')
        GROUP BY day
      ),
      burns AS (
        SELECT day,
          SUM(ABS(CAST(amount0 AS DOUBLE)) / POW(10, ${token0Decimals})) AS weth_removed,
          SUM(ABS(CAST(amount1 AS DOUBLE)) / POW(10, ${token1Decimals})) AS usdc_removed,
          COUNT(*) AS burn_count
        FROM read_parquet('${burnsPath}')
        GROUP BY day
      ),
      all_days AS (
        SELECT day FROM mints UNION SELECT day FROM burns
      )
      SELECT
        d.day,
        COALESCE(m.weth_added, 0) AS weth_added,
        COALESCE(b.weth_removed, 0) AS weth_removed,
        COALESCE(m.weth_added, 0) - COALESCE(b.weth_removed, 0) AS net_weth,
        COALESCE(m.usdc_added, 0) AS usdc_added,
        COALESCE(b.usdc_removed, 0) AS usdc_removed,
        COALESCE(m.usdc_added, 0) - COALESCE(b.usdc_removed, 0) AS net_usdc,
        COALESCE(p.weth_price_usdc, 0) AS weth_price_usdc,
        (COALESCE(m.usdc_added, 0) - COALESCE(b.usdc_removed, 0))
          + (COALESCE(m.weth_added, 0) - COALESCE(b.weth_removed, 0)) * COALESCE(p.weth_price_usdc, 0)
          AS net_usd,
        COALESCE(m.mint_count, 0) AS mint_count,
        COALESCE(b.burn_count, 0) AS burn_count
      FROM all_days d
      LEFT JOIN mints m ON d.day = m.day
      LEFT JOIN burns b ON d.day = b.day
      LEFT JOIN swap_price p ON d.day = p.day
      ORDER BY d.day
    ) TO '${resolve(outDir, "daily_net_liquidity.parquet")}' (FORMAT PARQUET)
  `);

  // ── Daily active wallets by role ────────────────────────────────────
  console.log("Building daily_active_wallets...");
  await conn.run(`
    COPY (
      WITH swap_wallets AS (
        SELECT day, sender AS wallet FROM read_parquet('${swapsPath}')
        UNION
        SELECT day, recipient AS wallet FROM read_parquet('${swapsPath}')
      ),
      lp_wallets AS (
        SELECT day, owner AS wallet FROM read_parquet('${mintsPath}')
        UNION
        SELECT day, owner AS wallet FROM read_parquet('${burnsPath}')
      ),
      swap_set AS (
        SELECT DISTINCT day, wallet FROM swap_wallets
      ),
      lp_set AS (
        SELECT DISTINCT day, wallet FROM lp_wallets
      ),
      classified AS (
        SELECT
          COALESCE(s.day, l.day) AS day,
          COALESCE(s.wallet, l.wallet) AS wallet,
          CASE
            WHEN s.wallet IS NOT NULL AND l.wallet IS NOT NULL THEN 'both'
            WHEN s.wallet IS NOT NULL THEN 'swapper'
            ELSE 'lp'
          END AS role
        FROM swap_set s
        FULL OUTER JOIN lp_set l ON s.day = l.day AND s.wallet = l.wallet
      )
      SELECT
        day,
        COUNT(CASE WHEN role = 'swapper' THEN 1 END) AS active_swappers,
        COUNT(CASE WHEN role = 'lp' THEN 1 END) AS active_liquidity_providers,
        COUNT(CASE WHEN role = 'both' THEN 1 END) AS active_both,
        COUNT(*) AS active_total
      FROM classified
      GROUP BY day
      ORDER BY day
    ) TO '${resolve(outDir, "daily_active_wallets.parquet")}' (FORMAT PARQUET)
  `);

  // ── Daily swap count ────────────────────────────────────────────────
  console.log("Building daily_swap_count...");
  await conn.run(`
    COPY (
      SELECT day, COUNT(*) AS swap_count
      FROM read_parquet('${swapsPath}')
      GROUP BY day
      ORDER BY day
    ) TO '${resolve(outDir, "daily_swap_count.parquet")}' (FORMAT PARQUET)
  `);

  // ── Daily volume proxy ──────────────────────────────────────────────
  console.log("Building daily_volume_proxy...");
  await conn.run(`
    COPY (
      SELECT
        day,
        SUM(ABS(CAST(amount0 AS DOUBLE)) / POW(10, ${token0Decimals})) AS volume_token0,
        COUNT(*) AS swap_count
      FROM read_parquet('${swapsPath}')
      GROUP BY day
      ORDER BY day
    ) TO '${resolve(outDir, "daily_volume_proxy.parquet")}' (FORMAT PARQUET)
  `);

  // ── Top wallets ─────────────────────────────────────────────────────
  console.log("Building top_wallets...");
  await conn.run(`
    COPY (
      WITH interactions AS (
        SELECT sender AS wallet, 'swap' AS action FROM read_parquet('${swapsPath}')
        UNION ALL
        SELECT recipient AS wallet, 'swap' AS action FROM read_parquet('${swapsPath}')
        UNION ALL
        SELECT owner AS wallet, 'mint' AS action FROM read_parquet('${mintsPath}')
        UNION ALL
        SELECT owner AS wallet, 'burn' AS action FROM read_parquet('${burnsPath}')
      ),
      counts AS (
        SELECT
          wallet AS address,
          COUNT(CASE WHEN action = 'swap' THEN 1 END) AS swap_count,
          COUNT(CASE WHEN action = 'mint' THEN 1 END) AS mint_count,
          COUNT(CASE WHEN action = 'burn' THEN 1 END) AS burn_count,
          COUNT(*) AS total_interactions
        FROM interactions
        GROUP BY wallet
      )
      SELECT
        address,
        CASE
          WHEN swap_count > 0 AND (mint_count > 0 OR burn_count > 0) THEN 'both'
          WHEN swap_count > 0 THEN 'swapper'
          ELSE 'liquidity_provider'
        END AS role,
        swap_count,
        mint_count,
        burn_count,
        total_interactions
      FROM counts
      ORDER BY total_interactions DESC
      LIMIT 200
    ) TO '${resolve(outDir, "top_wallets.parquet")}' (FORMAT PARQUET)
  `);

  // Log row counts
  for (const table of [
    "daily_fee_estimate",
    "daily_net_liquidity",
    "daily_active_wallets",
    "daily_swap_count",
    "daily_volume_proxy",
    "top_wallets",
  ]) {
    const reader = await conn.runAndReadAll(
      `SELECT COUNT(*) AS c FROM read_parquet('${resolve(outDir, table + ".parquet")}')`
    );
    const rows = reader.getRows();
    console.log(`  ${table}: ${rows[0]?.[0] ?? 0} rows`);
  }

  console.log("Metrics complete.\n");
}

main().catch((err) => {
  console.error("Metrics failed:", err);
  process.exit(1);
});
