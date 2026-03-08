import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { getFees, getLiquidity, getActiveWallets, getSupporting } from "../lib/api";
import { ChartCard } from "../components/ChartCard";
import { DataTable } from "../components/DataTable";
import { chartAxisTick, chartTheme, chartTooltipStyle } from "../lib/chartTheme";

interface MetricSection {
  key: string;
  title: string;
  description: string;
  formula: string;
}

const SECTIONS: MetricSection[] = [
  {
    key: "fees",
    title: "Daily Fee Estimate",
    description:
      "Estimated swap fees per day. Uses absolute token0 (WETH) amounts multiplied by the pool fee tier (0.05%). This is a transparent demo simplification.",
    formula: "fee_estimate = SUM(ABS(amount0) / 10^18 * 0.0005)",
  },
  {
    key: "liquidity",
    title: "Net Liquidity Change",
    description:
      "Token amounts added minus removed each day by liquidity providers (Mint and Burn events). Shown in WETH and USDC.",
    formula: "net_weth = SUM(mint.amount0 / 10^18) - SUM(burn.amount0 / 10^18), net_usdc = SUM(mint.amount1 / 10^6) - SUM(burn.amount1 / 10^6)",
  },
  {
    key: "wallets",
    title: "Active Wallets by Role",
    description:
      "Unique wallets per day classified as swapper, liquidity provider, or both based on event participation.",
    formula: "Count distinct wallets per role per day",
  },
  {
    key: "swapCount",
    title: "Daily Swap Count",
    description: "Total decoded Swap events per day.",
    formula: "swap_count = COUNT(swaps) per day",
  },
  {
    key: "volume",
    title: "Daily Volume Proxy",
    description:
      "Proxy for daily volume using absolute token0 amounts. Not a precise economic measure — a consistent, documented proxy.",
    formula: "volume_token0 = SUM(ABS(amount0) / 10^18) per day",
  },
];

export function MetricsPage() {
  const [fees, setFees] = useState<unknown[]>([]);
  const [liquidity, setLiquidity] = useState<unknown[]>([]);
  const [wallets, setWallets] = useState<unknown[]>([]);
  const [swapCount, setSwapCount] = useState<unknown[]>([]);
  const [volume, setVolume] = useState<unknown[]>([]);
  const [showTable, setShowTable] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getFees(), getLiquidity(), getActiveWallets(), getSupporting()])
      .then(([fe, lq, wl, sp]) => {
        setFees(fe.data);
        setLiquidity(lq.data);
        setWallets(wl.data);
        setSwapCount(sp.data.swapCount);
        setVolume(sp.data.volumeProxy);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="state-message state-message--error">Error: {error}</div>;

  const dataMap: Record<string, unknown[]> = { fees, liquidity, wallets, swapCount, volume };

  const chartMap: Record<string, (data: unknown[]) => React.ReactNode> = {
    fees: (data) => (
      <AreaChart data={data as Record<string, unknown>[]}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="day" tick={chartAxisTick} />
        <YAxis tick={chartAxisTick} />
        <Tooltip contentStyle={chartTooltipStyle} />
        <Area type="monotone" dataKey="fee_estimate" stroke={chartTheme.accentBlue} fill={chartTheme.accentBlueFill} fillOpacity={chartTheme.fillOpacity} />
      </AreaChart>
    ),
    liquidity: (data) => (
      <BarChart data={data as Record<string, unknown>[]}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="day" tick={chartAxisTick} />
        <YAxis tick={chartAxisTick} />
        <Tooltip contentStyle={chartTooltipStyle} />
        <Bar dataKey="weth_added" fill={chartTheme.accentGreen} fillOpacity={chartTheme.barOpacity} name="WETH Added" />
        <Bar dataKey="weth_removed" fill={chartTheme.accentRed} fillOpacity={chartTheme.barOpacity} name="WETH Removed" />
      </BarChart>
    ),
    wallets: (data) => (
      <BarChart data={data as Record<string, unknown>[]}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="day" tick={chartAxisTick} />
        <YAxis tick={chartAxisTick} />
        <Tooltip contentStyle={chartTooltipStyle} />
        <Bar dataKey="active_swappers" stackId="a" fill={chartTheme.accentBlue} name="Swappers" />
        <Bar dataKey="active_liquidity_providers" stackId="a" fill={chartTheme.accentGreen} name="LPs" />
        <Bar dataKey="active_both" stackId="a" fill={chartTheme.accentAmber} name="Both" />
      </BarChart>
    ),
    swapCount: (data) => (
      <BarChart data={data as Record<string, unknown>[]}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="day" tick={chartAxisTick} />
        <YAxis tick={chartAxisTick} />
        <Tooltip contentStyle={chartTooltipStyle} />
        <Bar dataKey="swap_count" fill={chartTheme.accentBlue} fillOpacity={chartTheme.barOpacity} />
      </BarChart>
    ),
    volume: (data) => (
      <AreaChart data={data as Record<string, unknown>[]}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="day" tick={chartAxisTick} />
        <YAxis tick={chartAxisTick} />
        <Tooltip contentStyle={chartTooltipStyle} />
        <Area type="monotone" dataKey="volume_token0" stroke={chartTheme.accentGreen} fill={chartTheme.accentGreen} fillOpacity={chartTheme.fillOpacity} />
      </AreaChart>
    ),
  };

  return (
    <div className="page page--metrics">
      <div className="page__header">
        <h1 className="page__title">Metrics</h1>
        <p className="page__subtitle">All derived metrics with descriptions, formulas, and raw data</p>
      </div>

      {SECTIONS.map((section) => {
        const data = dataMap[section.key] ?? [];
        const columns = data.length > 0 ? Object.keys(data[0] as Record<string, unknown>) : [];
        const tableVisible = showTable[section.key] ?? false;

        return (
          <div key={section.key} className="metric-section">
            <div className="metric-section__header">
              <h2 className="metric-section__title">{section.title}</h2>
              <p className="metric-section__description">{section.description}</p>
              <p className="metric-section__formula">{section.formula}</p>
            </div>

            <ChartCard title="">
              <ResponsiveContainer width="100%" height="100%">
                {chartMap[section.key]?.(data) ?? <div />}
              </ResponsiveContainer>
            </ChartCard>

            <button
              onClick={() => setShowTable((prev) => ({ ...prev, [section.key]: !prev[section.key] }))}
              className="tt-button tt-button--ghost"
            >
              {tableVisible ? "Hide table" : "Show table"}
            </button>

            {tableVisible && columns.length > 0 && (
              <DataTable columns={columns} rows={data as Record<string, unknown>[]} />
            )}
          </div>
        );
      })}
    </div>
  );
}
