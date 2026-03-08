import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";
import { getOverview, getFees, getLiquidity, getActiveWallets } from "../lib/api";
import { MetricCard } from "../components/MetricCard";
import { ChartCard } from "../components/ChartCard";
import { chartAxisTick, chartTheme, chartTooltipLabelStyle, chartTooltipStyle } from "../lib/chartTheme";

export function OverviewPage() {
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof getOverview>>["data"] | null>(null);
  const [fees, setFees] = useState<Awaited<ReturnType<typeof getFees>>["data"]>([]);
  const [liquidity, setLiquidity] = useState<Awaited<ReturnType<typeof getLiquidity>>["data"]>([]);
  const [wallets, setWallets] = useState<Awaited<ReturnType<typeof getActiveWallets>>["data"]>([]);
  const [cacheStatus, setCacheStatus] = useState<string>("—");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getOverview(), getFees(), getLiquidity(), getActiveWallets()])
      .then(([ov, fe, lq, wl]) => {
        setOverview(ov.data);
        setFees(fe.data);
        setLiquidity(lq.data);
        setWallets(wl.data);
        setCacheStatus(ov.cache.status);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="state-message state-message--error">Error: {error}</div>;
  if (!overview) return <div className="state-message">Loading...</div>;

  const { pool, blockRange, lastPipelineRun, pipelineSource, latestMetrics, dataFreshness } = overview;

  return (
    <div className="page page--overview">
      {/* Header */}
      <div className="page__header">
        <h1 className="page__title">{pool.name}</h1>
        <p className="page__subtitle">
          {pool.dex} on {pool.chain} &middot; Fee tier {pool.feeTier}
        </p>
      </div>

      {/* Headline metrics */}
      <div className="metric-grid">
        <MetricCard
          title="Daily Fee Estimate"
          value={latestMetrics.feeEstimate ? `${latestMetrics.feeEstimate.fee_estimate.toFixed(6)} WETH` : null}
          subtitle={latestMetrics.feeEstimate ? `${latestMetrics.feeEstimate.swap_count} swaps on ${latestMetrics.feeEstimate.day}` : undefined}
          accent="indigo"
        />
        <MetricCard
          title="Net Liquidity Change"
          value={
            latestMetrics.netLiquidity
              ? `${Number(latestMetrics.netLiquidity.net_usd) >= 0 ? "+" : "-"}$${Math.abs(Number(latestMetrics.netLiquidity.net_usd)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : null
          }
          subtitle={
            latestMetrics.netLiquidity
              ? `${Number(latestMetrics.netLiquidity.net_weth).toFixed(4)} WETH · ${Number(latestMetrics.netLiquidity.net_usdc).toFixed(2)} USDC · ${latestMetrics.netLiquidity.mint_count} mints, ${latestMetrics.netLiquidity.burn_count} burns`
              : undefined
          }
          accent="emerald"
        />
        <MetricCard
          title="Active Wallets"
          value={latestMetrics.activeWallets?.active_total ?? null}
          subtitle={
            latestMetrics.activeWallets
              ? `${latestMetrics.activeWallets.active_swappers} swappers, ${latestMetrics.activeWallets.active_liquidity_providers} LPs, ${latestMetrics.activeWallets.active_both} both`
              : undefined
          }
          accent="amber"
        />
      </div>

      {/* Charts */}
      <div className="chart-grid">
        <ChartCard title="Daily Fee Estimate" description="WETH-denominated fee estimate per day">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={fees}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis dataKey="day" tick={chartAxisTick} />
              <YAxis tick={chartAxisTick} />
              <Tooltip
                contentStyle={chartTooltipStyle}
                labelStyle={chartTooltipLabelStyle}
              />
              <Area
                type="monotone"
                dataKey="fee_estimate"
                stroke={chartTheme.accentBlue}
                fill={chartTheme.accentBlueFill}
                fillOpacity={chartTheme.fillOpacity}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Net Liquidity Change (USD)" description="USD-equivalent net LP capital flow per day (WETH priced from pool swaps)">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={liquidity}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis dataKey="day" tick={chartAxisTick} />
              <YAxis tick={chartAxisTick} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={chartTooltipStyle}
                labelStyle={chartTooltipLabelStyle}
                formatter={(value) => [`$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, undefined]}
              />
              <Bar dataKey="net_usd" name="Net USD" fill={chartTheme.accentGreen} fillOpacity={chartTheme.barOpacity} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Active Wallets by Role" description="Unique wallets per day, classified by interaction type">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={wallets}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis dataKey="day" tick={chartAxisTick} />
              <YAxis tick={chartAxisTick} />
              <Tooltip
                contentStyle={chartTooltipStyle}
                labelStyle={chartTooltipLabelStyle}
              />
              <Bar dataKey="active_swappers" stackId="a" fill={chartTheme.accentBlue} name="Swappers" />
              <Bar dataKey="active_liquidity_providers" stackId="a" fill={chartTheme.accentGreen} name="LPs" />
              <Bar dataKey="active_both" stackId="a" fill={chartTheme.accentAmber} name="Both" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Info panel */}
      <div className="info-panel">
        <div className="info-panel__item">
          <p className="info-panel__label">Cache Status</p>
          <p className="info-panel__value">{cacheStatus}</p>
        </div>
        <div className="info-panel__item">
          <p className="info-panel__label">Data Source</p>
          <p className="info-panel__value">{pipelineSource ?? "—"}</p>
        </div>
        <div className="info-panel__item">
          <p className="info-panel__label">Block Range</p>
          <p className="info-panel__value info-panel__value--mono">
            {blockRange.from.toLocaleString()} — {blockRange.to.toLocaleString()}
          </p>
        </div>
        <div className="info-panel__item">
          <p className="info-panel__label">Last Pipeline Run</p>
          <p className="info-panel__value">{lastPipelineRun ? new Date(lastPipelineRun).toLocaleString() : "—"}</p>
        </div>
        <div className="info-panel__item">
          <p className="info-panel__label">Event Counts</p>
          <p className="info-panel__value">
            {dataFreshness.rowCounts
              ? `${dataFreshness.rowCounts.swaps} swaps, ${dataFreshness.rowCounts.mints} mints, ${dataFreshness.rowCounts.burns} burns`
              : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
