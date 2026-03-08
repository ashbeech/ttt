import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { registerTools, toolInputSchemas } from "./tools.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type ToolCallResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type ToolHandler = (args?: Record<string, unknown>) => Promise<ToolCallResult>;

function parseToolResult(result: ToolCallResult): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function createFakeServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    handlers,
    server: {
      registerTool(
        name: string,
        _config: Record<string, unknown>,
        handler: ToolHandler,
      ) {
        handlers.set(name, handler);
      },
    } as unknown as McpServer,
  };
}

const originalFetch = globalThis.fetch;

describe("MCP tool schemas", () => {
  test("date-range schema rejects bad date formats", () => {
    expect(() => toolInputSchemas.dateRange.parse({ from: "2026/01/01" })).toThrow();
    expect(toolInputSchemas.dateRange.parse({ from: "2026-01-01", to: "2026-01-05" })).toEqual({
      from: "2026-01-01",
      to: "2026-01-05",
    });
  });

  test("top-wallet schema enforces integer bounds", () => {
    expect(toolInputSchemas.topWallets.parse({})).toEqual({ limit: 50 });
    expect(() => toolInputSchemas.topWallets.parse({ limit: 0 })).toThrow();
    expect(() => toolInputSchemas.topWallets.parse({ limit: 201 })).toThrow();
  });

  test("metric-lineage schema requires non-empty metricName", () => {
    expect(() => toolInputSchemas.metricLineage.parse({ metricName: "" })).toThrow();
    expect(toolInputSchemas.metricLineage.parse({ metricName: "daily_fee_estimate" })).toEqual({
      metricName: "daily_fee_estimate",
    });
  });
});

describe("MCP tools", () => {
  let handlers: Map<string, ToolHandler>;

  beforeEach(() => {
    const fake = createFakeServer();
    handlers = fake.handlers;
    registerTools(fake.server);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("happy path: get_overview proxies API response", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ data: { pool: { name: "USDC/WETH" } }, cache: { status: "miss", ttlSeconds: 60 } }),
        { status: 200 },
      )) as typeof fetch;

    const result = await handlers.get("get_overview")?.();
    expect(result).toBeDefined();
    expect(result!.isError).toBeFalsy();
    const parsed = parseToolResult(result!);

    expect(parsed.ok).toBe(true);
    expect(parsed.source).toBe("api");
    expect(parsed.endpoint).toBe("/api/overview");
    expect(parsed.data).toEqual({ pool: { name: "USDC/WETH" } });
    expect(parsed.cache).toEqual({ status: "miss", ttlSeconds: 60 });
    expect((parsed.trace as Record<string, unknown>).traceId).toBeString();
  });

  test("happy path: get_fees includes date query", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ data: [{ day: "2026-01-01", fee_estimate: 1.23 }], cache: { status: "hit", ttlSeconds: 300 } }),
        { status: 200 },
      )) as typeof fetch;

    const result = await handlers.get("get_fees")?.({ from: "2026-01-01", to: "2026-01-31" });
    const parsed = parseToolResult(result!);

    expect(parsed.ok).toBe(true);
    expect(parsed.endpoint).toBe("/api/metrics/fees?from=2026-01-01&to=2026-01-31");
    expect(parsed.data).toEqual([{ day: "2026-01-01", fee_estimate: 1.23 }]);
  });

  test("happy path: response JSON is compact (no pretty-print)", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { x: 1 }, cache: { status: "miss", ttlSeconds: 60 } }), { status: 200 })) as typeof fetch;

    const result = await handlers.get("get_overview")?.();
    const raw = result!.content[0].text;
    expect(raw).not.toContain("\n");
  });

  test("failure path: unknown metric returns upstream 404", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Unknown metric: nope" }), { status: 404, statusText: "Not Found" })) as typeof fetch;

    const result = await handlers.get("get_metric_lineage")?.({ metricName: "nope" });
    expect(result!.isError).toBe(true);
    const parsed = parseToolResult(result!);

    expect(parsed.ok).toBe(false);
    expect((parsed.error as Record<string, unknown>).status).toBe(404);
    expect((parsed.error as Record<string, unknown>).code).toBe("UPSTREAM_HTTP_ERROR");
  });

  test("failure path: upstream network error is normalized", async () => {
    globalThis.fetch = (async () => {
      throw new Error("socket hang up");
    }) as typeof fetch;

    const result = await handlers.get("get_overview")?.();
    expect(result!.isError).toBe(true);
    const parsed = parseToolResult(result!);

    expect(parsed.ok).toBe(false);
    expect((parsed.error as Record<string, unknown>).code).toBe("UPSTREAM_NETWORK_ERROR");
  });

  test("happy path: get_pipeline_manifest reads from disk", async () => {
    const result = await handlers.get("get_pipeline_manifest")?.();
    expect(result).toBeDefined();
    const parsed = parseToolResult(result!);
    expect(parsed.source).toBe("manifest");

    if (parsed.ok) {
      const data = parsed.data as Record<string, unknown>;
      expect(data).toHaveProperty("runAt");
      expect(data).toHaveProperty("rowCounts");
      expect(data).toHaveProperty("blockRange");
    } else {
      expect((parsed.error as Record<string, unknown>).code).toBe("MANIFEST_NOT_FOUND");
    }
  });
});
