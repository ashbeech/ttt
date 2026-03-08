import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config, type PipelineManifest } from "@mini-terminal/shared";
import { fetchApi, type ToolResult } from "./http.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const maxDateSpanDays = Number(process.env.MCP_MAX_DATE_SPAN_DAYS ?? "0");

function parseDate(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function enforceDateSpan(from?: string, to?: string): ToolResult<never> | null {
  if (!from || !to || !Number.isFinite(maxDateSpanDays) || maxDateSpanDays <= 0) return null;
  const days = Math.floor((parseDate(to) - parseDate(from)) / 86_400_000);
  if (days <= maxDateSpanDays) return null;

  return {
    ok: false,
    source: "api",
    endpoint: "date-guardrail",
    error: {
      code: "DATE_SPAN_TOO_LARGE",
      message: `Requested span exceeds MCP_MAX_DATE_SPAN_DAYS=${maxDateSpanDays}`,
      details: { from, to, requestedDays: days },
    },
    trace: {
      traceId: crypto.randomUUID(),
      requestedAt: new Date().toISOString(),
    },
  };
}

function toContent(result: ToolResult<unknown>): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError: !result.ok,
  };
}

function readManifest(): ToolResult<PipelineManifest> {
  const endpoint = "data/processed/pipeline-manifest.json";
  const filePath = resolve(config.paths.processedDir, "pipeline-manifest.json");
  const trace = {
    traceId: crypto.randomUUID(),
    requestedAt: new Date().toISOString(),
  };

  if (!existsSync(filePath)) {
    return {
      ok: false,
      source: "manifest",
      endpoint,
      error: {
        code: "MANIFEST_NOT_FOUND",
        message: "Pipeline manifest is missing. Run the pipeline first.",
      },
      trace,
    };
  }

  try {
    const payload = JSON.parse(readFileSync(filePath, "utf-8")) as PipelineManifest;
    return {
      ok: true,
      source: "manifest",
      endpoint,
      data: payload,
      trace,
    };
  } catch (error) {
    return {
      ok: false,
      source: "manifest",
      endpoint,
      error: {
        code: "MANIFEST_PARSE_ERROR",
        message: "Failed to parse pipeline manifest JSON.",
        details: error instanceof Error ? error.message : String(error),
      },
      trace,
    };
  }
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true as const,
  destructiveHint: false as const,
  idempotentHint: true as const,
  openWorldHint: false as const,
};

const dateRangeInputSchema = {
  from: z.string().regex(DATE_RE).describe("Start date (inclusive) in YYYY-MM-DD format").optional(),
  to: z.string().regex(DATE_RE).describe("End date (inclusive) in YYYY-MM-DD format").optional(),
};

const topWalletsInputSchema = {
  limit: z.number().int().min(1).max(200).default(50).describe("Maximum number of wallets to return (1-200, default 50)"),
};

const metricLineageInputSchema = {
  metricName: z.string().min(1).describe("Metric key, e.g. 'daily_fee_estimate'. Use list_lineage_metrics to discover valid keys."),
};

export const toolInputSchemas = {
  dateRange: z.object(dateRangeInputSchema),
  topWallets: z.object(topWalletsInputSchema),
  metricLineage: z.object(metricLineageInputSchema),
};

async function handleDateRangeTool(endpoint: string, from?: string, to?: string) {
  const blocked = enforceDateSpan(from, to);
  if (blocked) return toContent(blocked);
  return toContent(await fetchApi(endpoint, { from, to }));
}

export function registerTools(server: McpServer) {
  server.registerTool("get_health", {
    description: "Check whether the upstream Fastify API is reachable. Returns {status:'ok'} on success. Use this before other tools if you suspect the API may be down.",
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => toContent(await fetchApi("/api/health")));

  server.registerTool("get_overview", {
    description: "Fetch a top-level analytics summary: pool metadata, latest headline metrics (fee estimate, net liquidity, active wallets), block range, pipeline run timestamp, and data freshness. Good starting point for understanding current state.",
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => toContent(await fetchApi("/api/overview")));

  server.registerTool("get_fees", {
    description: "Fetch daily fee-estimate rows for the USDC/WETH pool. Each row contains day, fee_token, fee_estimate (WETH), swap_count, and source_event_count. Supports optional date-range filtering.",
    inputSchema: dateRangeInputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ from, to }) => handleDateRangeTool("/api/metrics/fees", from, to));

  server.registerTool("get_liquidity", {
    description: "Fetch daily net-liquidity rows showing WETH/USDC added, removed, and net change per day, plus mint and burn counts. Supports optional date-range filtering.",
    inputSchema: dateRangeInputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ from, to }) => handleDateRangeTool("/api/metrics/liquidity", from, to));

  server.registerTool("get_active_wallets", {
    description: "Fetch daily active-wallet counts, broken down by role: swappers, liquidity providers, both, and total. Supports optional date-range filtering.",
    inputSchema: dateRangeInputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ from, to }) => handleDateRangeTool("/api/metrics/active-wallets", from, to));

  server.registerTool("get_supporting_metrics", {
    description: "Fetch supporting daily metrics: daily swap count and daily volume proxy (sum of absolute token0 amounts). Supports optional date-range filtering.",
    inputSchema: dateRangeInputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ from, to }) => handleDateRangeTool("/api/metrics/supporting", from, to));

  server.registerTool("get_top_wallets", {
    description: "Fetch wallets ranked by total on-chain interactions (swaps + mints + burns). Each row includes address, role classification (swapper/liquidity_provider/both), per-type counts, and total.",
    inputSchema: topWalletsInputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ limit }) => toContent(await fetchApi("/api/wallets/top", { limit: Number(limit) })));

  server.registerTool("list_lineage_metrics", {
    description: "List all available metric keys with their human-readable name, description, formula, and source events. Use this to discover valid metricName values for get_metric_lineage.",
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => toContent(await fetchApi("/api/lineage")));

  server.registerTool("get_metric_lineage", {
    description: "Fetch full data-lineage detail for a specific metric: formula, source events, raw file paths, intermediate file paths, and sample rows from each stage. Use list_lineage_metrics first to find valid metric keys.",
    inputSchema: metricLineageInputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ metricName }) => toContent(await fetchApi(`/api/lineage/${String(metricName)}`)));

  server.registerTool("get_pipeline_manifest", {
    description: "Read the latest pipeline-manifest.json from disk (not via API). Returns run timestamp, data source (seed/live), block range, file counts, row counts, and duration. Useful for checking data freshness without hitting the API.",
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => toContent(readManifest()));
}
