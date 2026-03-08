import { config } from "@mini-terminal/shared";

export type ToolSource = "api" | "manifest";

export interface ToolError {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
}

export interface ToolTrace {
  traceId: string;
  requestedAt: string;
  url?: string;
}

export interface ToolResult<T> {
  ok: boolean;
  source: ToolSource;
  endpoint: string;
  data?: T;
  cache?: { status: string; ttlSeconds: number };
  error?: ToolError;
  trace: ToolTrace;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.MCP_TIMEOUT_MS ?? 6_000);

export function getApiBaseUrl(): string {
  return process.env.MCP_API_BASE_URL ?? `http://127.0.0.1:${config.apiPort}`;
}

export function buildQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

function newTrace(url?: string): ToolTrace {
  return {
    traceId: crypto.randomUUID(),
    requestedAt: new Date().toISOString(),
    url,
  };
}

export async function fetchApi<T>(
  endpoint: string,
  params: Record<string, string | number | undefined> = {}
): Promise<ToolResult<T>> {
  const endpointWithQuery = `${endpoint}${buildQueryString(params)}`;
  const url = new URL(endpointWithQuery, getApiBaseUrl()).toString();
  const trace = newTrace(url);
  const timeoutMs = Number.isFinite(DEFAULT_TIMEOUT_MS) ? DEFAULT_TIMEOUT_MS : 6_000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const bodySnippet =
        typeof payload === "object" && payload !== null ? payload : { body: "Upstream response was not JSON." };
      return {
        ok: false,
        source: "api",
        endpoint: endpointWithQuery,
        error: {
          code: "UPSTREAM_HTTP_ERROR",
          message: `API returned ${response.status} ${response.statusText}`,
          status: response.status,
          details: bodySnippet,
        },
        trace,
      };
    }

    const maybeData = payload as { data?: T; cache?: { status: string; ttlSeconds: number } } | null;
    return {
      ok: true,
      source: "api",
      endpoint: endpointWithQuery,
      data: (maybeData?.data ?? payload) as T,
      cache: maybeData?.cache,
      trace,
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      source: "api",
      endpoint: endpointWithQuery,
      error: {
        code: isTimeout ? "UPSTREAM_TIMEOUT" : "UPSTREAM_NETWORK_ERROR",
        message: isTimeout
          ? `API request timed out after ${timeoutMs}ms`
          : "Unable to reach API endpoint",
        details: error instanceof Error ? error.message : String(error),
      },
      trace,
    };
  } finally {
    clearTimeout(timeout);
  }
}
