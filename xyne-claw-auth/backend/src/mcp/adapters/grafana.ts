import type { StdioMcpAdapter, McpToolInfo } from "../types.js";

export const grafanaAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "grafana",
  healthCheck: { name: "search_dashboards", params: { query: "" } },
  credentialFields: [
    { name: "url", label: "Grafana URL", type: "text", placeholder: "https://your-grafana.example.com" },
    { name: "token", label: "Service Account Token", type: "password", placeholder: "glsa_xxxxxxxxxxxxxxxxxxxx" },
  ],
  buildCommand(credentials) {
    const url = credentials["url"] as string;
    const token = credentials["token"] as string;
    return {
      cmd: "uvx",
      args: ["mcp-grafana"],
      env: {
        GRAFANA_URL: url,
        GRAFANA_SERVICE_ACCOUNT_TOKEN: token,
      },
    };
  },
};

// ── Custom Grafana tools (handled locally, not forwarded to MCP server) ─────

export const GRAFANA_CUSTOM_TOOLS: McpToolInfo[] = [
  {
    name: "grafana-query-logs",
    description:
      "Query application logs from Victoria Logs via Grafana using LogsQL. " +
      "Key containers: xyne-backend, xyne-spaces-zero, xyne-logging-bridge (client-side). " +
      "Use field filters like container:\"name\" AND level:\"error\". " +
      "Client-side logs (logging-bridge) have fields: emailId, clientSessionId, platformName, event.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'LogsQL query. Examples: container:"xyne-backend" AND level:"error", ' +
            'container:"xyne-spaces-zero" AND "Advancement exceeded timeout", ' +
            'container:"xyne-logging-bridge" AND emailId:"user@example.com"',
        },
        start: {
          type: "string",
          description: 'Start time — duration like "15m", "1h", "24h" or ISO timestamp',
        },
        end: { type: "string", description: "Optional end time (ISO timestamp). Omit for now." },
        limit: { type: "number", description: "Max log lines to return (default 50, max 200)" },
      },
      required: ["query", "start"],
    },
  },
  {
    name: "grafana-list-metrics",
    description:
      "List available metric names from VictoriaMetrics. Call first to discover metrics before building PromQL. " +
      "Key metrics: zero_sync_hydration_total, zero_sync_active_clients, zero_sync_poke_time_seconds, zero_replication_events_total.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: 'Substring to filter metric names (e.g. "zero", "http", "sync")' },
      },
    },
  },
  {
    name: "grafana-query-metrics",
    description:
      "Execute PromQL query against VictoriaMetrics via Grafana. Supports range and instant queries. " +
      "For histograms: histogram_quantile(0.95, sum(rate(METRIC_bucket[5m])) by (le)). " +
      "For client-side metrics use increase(...[1h])/3600 not rate().",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "PromQL expression" },
        start: { type: "string", description: "Start time — ISO timestamp" },
        end: { type: "string", description: "End time — ISO timestamp. Defaults to now." },
        step: { type: "string", description: 'Resolution step for range queries (default "60s")' },
        queryType: { type: "string", description: '"range" (default) or "instant"' },
      },
      required: ["query", "start"],
    },
  },
  {
    name: "grafana-query-database",
    description:
      "Execute read-only SQL against Xyne Spaces PostgreSQL via Grafana datasource proxy. " +
      "Use for investigating data issues — user counts, channel stats, message counts. SELECT only.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: 'SQL query (SELECT only). e.g. "SELECT count(*) FROM channels"' },
        timeRange: { type: "string", description: 'Time range context (default "1h"). e.g. "1h", "6h", "24h"' },
      },
      required: ["sql"],
    },
  },
];

// ── Execution handlers ──────────────────────────────────────────────────────

async function grafanaFetch(baseUrl: string, token: string, path: string, options?: RequestInit): Promise<Response> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
}

export async function handleGrafanaQueryLogs(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<string> {
  const baseUrl = credentials["url"] as string;
  const token = credentials["token"] as string;

  const query = params["query"] as string;
  const start = params["start"] as string;
  const end = params["end"] as string | undefined;
  const limit = Math.min((params["limit"] as number) || 50, 200);

  const searchParams = new URLSearchParams({ query, start, limit: String(limit) });
  if (end) searchParams.set("end", end);

  const res = await grafanaFetch(baseUrl, token, `/api/datasources/proxy/8/select/logsql/query?${searchParams.toString()}`);
  if (!res.ok) throw new Error(`Grafana returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);

  const text = await res.text();
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return "No logs found matching the query.";

  const entries: string[] = [];
  const errorPatterns: Record<string, number> = {};

  for (const line of lines) {
    try {
      const log = JSON.parse(line) as Record<string, unknown>;
      const ts = log["_time"] ?? log["timestamp"] ?? "";
      const level = log["level"] ?? log["_msg_level"] ?? "";
      const container = log["container"] ?? "";
      const msg = log["_msg"] ?? log["message"] ?? log["msg"] ?? "";
      const pod = log["pod"] ?? "";
      entries.push(`[${ts}] [${container}/${pod}] [${level}] ${String(msg).slice(0, 500)}`);

      if (String(level).toLowerCase() === "error") {
        const pattern = String(msg).slice(0, 100);
        errorPatterns[pattern] = (errorPatterns[pattern] || 0) + 1;
      }
    } catch {
      entries.push(line.slice(0, 500));
    }
  }

  let result = `**Found ${lines.length} log entries**\n\n`;
  if (Object.keys(errorPatterns).length > 0) {
    result += "**Error Patterns:**\n";
    for (const [pattern, count] of Object.entries(errorPatterns).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      result += `- (${count}x) ${pattern}\n`;
    }
    result += "\n";
  }
  result += "**Logs:**\n```\n" + entries.join("\n") + "\n```";
  return result;
}

export async function handleGrafanaListMetrics(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<string> {
  const baseUrl = credentials["url"] as string;
  const token = credentials["token"] as string;
  const filter = params["filter"] as string | undefined;

  const res = await grafanaFetch(baseUrl, token, "/api/datasources/proxy/7/api/v1/label/__name__/values");
  if (!res.ok) throw new Error(`Grafana returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);

  const data = (await res.json()) as { data?: string[] };
  let metrics = data.data ?? [];

  if (filter) {
    const lower = filter.toLowerCase();
    metrics = metrics.filter((m) => m.toLowerCase().includes(lower));
  }

  if (metrics.length === 0) return filter ? `No metrics found matching "${filter}".` : "No metrics found.";
  return `**${metrics.length} metrics found:**\n${metrics.join("\n")}`;
}

export async function handleGrafanaQueryMetrics(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<string> {
  const baseUrl = credentials["url"] as string;
  const token = credentials["token"] as string;

  const query = params["query"] as string;
  const start = params["start"] as string;
  const end = (params["end"] as string) || new Date().toISOString();
  const step = (params["step"] as string) || "60s";
  const queryType = (params["queryType"] as string) || "range";

  const startTs = String(Math.floor(new Date(start).getTime() / 1000));
  const endTs = String(Math.floor(new Date(end).getTime() / 1000));

  let path: string;
  const sp = new URLSearchParams({ query });

  if (queryType === "instant") {
    sp.set("time", endTs);
    path = `/api/datasources/proxy/7/api/v1/query?${sp.toString()}`;
  } else {
    sp.set("start", startTs);
    sp.set("end", endTs);
    sp.set("step", step);
    path = `/api/datasources/proxy/7/api/v1/query_range?${sp.toString()}`;
  }

  const res = await grafanaFetch(baseUrl, token, path);
  if (!res.ok) throw new Error(`Grafana returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);

  const data = (await res.json()) as {
    data?: {
      resultType?: string;
      result?: Array<{ metric: Record<string, string>; values?: [number, string][]; value?: [number, string] }>;
    };
  };

  const results = data.data?.result ?? [];
  if (results.length === 0) return "No data returned for this query.";

  let output = `**Query:** \`${query}\`\n**Type:** ${data.data?.resultType ?? queryType}\n**Results:** ${results.length} series\n\n`;

  for (const series of results.slice(0, 20)) {
    const labels = Object.entries(series.metric).map(([k, v]) => `${k}="${v}"`).join(", ");

    if (series.value) {
      const [ts, val] = series.value;
      output += `- {${labels}} → **${val}** (at ${new Date(ts * 1000).toISOString()})\n`;
    } else if (series.values) {
      const vals = series.values.map(([, v]) => parseFloat(v));
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const last = vals[vals.length - 1];
      output += `- {${labels || "total"}} → last: **${last?.toFixed(4)}**, min: ${min.toFixed(4)}, max: ${max.toFixed(4)} (${series.values.length} points)\n`;
    }
  }

  return output;
}

export async function handleGrafanaQueryDatabase(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<string> {
  const baseUrl = credentials["url"] as string;
  const token = credentials["token"] as string;

  const sql = (params["sql"] as string).trim();
  const timeRange = (params["timeRange"] as string) || "1h";

  if (!/^SELECT\b/i.test(sql)) return "Error: Only SELECT queries are allowed.";
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i.test(sql)) return "Error: Write operations are not allowed.";

  const res = await grafanaFetch(baseUrl, token, "/api/ds/query", {
    method: "POST",
    body: JSON.stringify({
      queries: [{
        refId: "A",
        datasource: { uid: "ff66nac1wz3eoe", type: "grafana-postgresql-datasource" },
        rawSql: sql,
        format: "table",
      }],
      from: `now-${timeRange}`,
      to: "now",
    }),
  });

  if (!res.ok) throw new Error(`Grafana returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);

  const data = (await res.json()) as {
    results?: Record<string, { frames?: Array<{ schema?: { fields?: Array<{ name: string }> }; data?: { values?: unknown[][] } }> }>;
  };

  const frame = data.results?.["A"]?.frames?.[0];
  if (!frame) return "No results returned.";

  const columns = frame.schema?.fields?.map((f) => f.name) ?? [];
  const values = frame.data?.values ?? [];
  if (columns.length === 0) return "Empty result set.";

  const rowCount = values[0]?.length ?? 0;
  let output = `**Query:** \`${sql}\`\n**Rows:** ${rowCount}\n\n`;
  output += `| ${columns.join(" | ")} |\n`;
  output += `| ${columns.map(() => "---").join(" | ")} |\n`;

  for (let r = 0; r < Math.min(rowCount, 50); r++) {
    const row = columns.map((_, c) => String(values[c]?.[r] ?? ""));
    output += `| ${row.join(" | ")} |\n`;
  }
  if (rowCount > 50) output += `\n... and ${rowCount - 50} more rows`;

  return output;
}
