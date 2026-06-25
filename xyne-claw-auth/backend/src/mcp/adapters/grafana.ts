import type { StdioMcpAdapter, McpToolInfo } from "../types.js";
import type { Citation } from "xyne-claw-shared";
import { CONFIG } from "../../config.js";

/** Base URL for the Explore citation link. Prefers the `GRAFANA_BASE_URL`
 *  env override so a single deployed Grafana can be the link target; falls
 *  back to the connection's credential `url` (the same URL the query uses). */
function citationBaseUrl(credentialUrl: string): string {
  return CONFIG.grafanaBaseUrl.trim() || credentialUrl;
}

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
        datasourceUid: {
          type: "string",
          description:
            "Optional VictoriaLogs datasource UID for building an Explore citation link. " +
            "Defaults to the configured VictoriaLogs proxy datasource.",
        },
        datasourceType: {
          type: "string",
          description: 'Optional datasource type for the citation link (default "victorialogs").',
        },
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
      "Execute read-only SQL against any SQL datasource wired into this Grafana instance " +
      "(PostgreSQL / MySQL / MSSQL / ClickHouse / etc.) via /api/ds/query. " +
      "Workflow: first call `list_datasources` to discover the UID + type, then pass them here. " +
      "SELECT (or WITH ... SELECT) only — writes are rejected. For ClickHouse, use ISO timestamps " +
      "in the SQL itself (Grafana relative ranges aren't honored by all SQL plugins).",
    inputSchema: {
      type: "object",
      properties: {
        datasourceUid: {
          type: "string",
          description:
            "Datasource UID from list_datasources. Required — never guess; the previous hardcoded " +
            "Spaces-Postgres default has been removed.",
        },
        datasourceType: {
          type: "string",
          description:
            'Grafana datasource type, e.g. "grafana-postgresql-datasource", "mysql", ' +
            '"grafana-clickhouse-datasource". Get it from list_datasources.',
        },
        sql: { type: "string", description: 'SQL query (SELECT or WITH ... SELECT). e.g. "SELECT count(*) FROM channels"' },
        timeRange: { type: "string", description: 'Time range context (default "1h"). e.g. "1h", "6h", "24h"' },
      },
      required: ["datasourceUid", "datasourceType", "sql"],
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

/**
 * Build a Grafana Explore deep link. The query is carried as a URL-encoded
 * JSON `panes` data parameter — it can never alter the host/path (F1). Base
 * URL comes from the Grafana connection's credential `url` (server-side, never
 * the model). `expr` for logs/prometheus, `rawSql` for SQL datasources.
 */
function buildGrafanaExploreUrl(baseUrl: string, opts: {
  datasourceUid: string;
  datasourceType: string;
  query: string;
  from?: string | undefined;
  to?: string | undefined;
}): string {
  const base = baseUrl.replace(/\/+$/, "");
  const type = opts.datasourceType.toLowerCase();
  const queryField = /postgres|mysql|mssql|clickhouse|sql/.test(type) ? "rawSql" : "expr";
  // Pane shape matches what Grafana's own "Share" emits: the pane-level
  // `datasource` is the bare uid STRING, and the per-query `datasource` is the
  // {type, uid} object. The query goes under `expr` (logs/prometheus) or
  // `rawSql` (SQL). `orgId=1` is required by Grafana when orgs are enabled.
  const panes = {
    xyne: {
      datasource: opts.datasourceUid,
      queries: [
        {
          refId: "A",
          datasource: { type: opts.datasourceType, uid: opts.datasourceUid },
          [queryField]: opts.query,
        },
      ],
      range: { from: opts.from ?? "now-1h", to: opts.to ?? "now" },
    },
  };
  return `${base}/explore?schemaVersion=1&panes=${encodeURIComponent(JSON.stringify(panes))}&orgId=1`;
}

/** Convert a LogsQL duration ("15m", "1h") or ISO timestamp to a Grafana
 *  now-relative/epoch `from` value. Pass-through for now-relative/epoch. */
function grafanaFromTime(start: string | undefined): string | undefined {
  if (!start) return undefined;
  if (/^now/.test(start) || /T\d{2}:\d{2}/.test(start) || /^\d{13}$/.test(start)) return start;
  const m = /^(\d+)([smhd])$/.exec(start);
  if (m) return `now-${m[1]}${m[2]}`;
  return start;
}

/** Build a Desk-readable citation label for an Explore link. Mirrors the
 *  label-enrichment step spaces-tools does via applyChannelInfo: centralize
 *  the label construction so every handler produces the same shape. */
function grafanaCitationLabel(kind: "logs" | "metrics" | "sql", query: string): string {
  const trimmed = query.trim().replace(/\s+/g, " ").slice(0, 60);
  const prefix =
    kind === "logs" ? "Grafana logs" : kind === "metrics" ? "Grafana metrics" : "Grafana SQL";
  return trimmed ? `${prefix}: ${trimmed}` : prefix;
}

/** Push an `external`-kind citation into `out`, deduped by URL. Mirrors the
 *  pushThreadCitation/pushCanvasCitation(out, seen, ...) pattern in
 *  xyne-spaces-tools.ts so external-connector citations flow through the same
 *  dedupe shape. `chunkIndex` defaults to 1 — Desk's findCitationForChunk
 *  matches it exactly against the `[clf-<toolCallId>#1]` token. */
function pushExternalCitation(
  out: Citation[],
  seen: Set<string>,
  url: string | undefined | null,
  label?: string,
  chunkIndex = 1,
): void {
  if (!url || seen.has(url)) return;
  seen.add(url);
  out.push({ kind: "external", url, ...(label ? { label } : {}), chunkIndex });
}

/** Attach citations to a handler result only when non-empty. Mirrors the
 *  okCited(text, citations) wrapper in xyne-spaces-tools.ts — local handlers
 *  return { content, citations? } (no MCP _meta transport) consumed by the
 *  mcp.ts unwrap() dispatch. */
function okCited(content: string, citations: Citation[]): { content: string; citations?: Citation[] } {
  return citations.length > 0 ? { content, citations } : { content };
}

export async function handleGrafanaQueryLogs(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
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
  if (lines.length === 0) return { content: "No logs found matching the query." };

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

  const datasourceUid = (params["datasourceUid"] as string | undefined) ?? "victoria-logs";
  const datasourceType = (params["datasourceType"] as string | undefined) ?? "victoriametrics-logs-datasource";
  const url = buildGrafanaExploreUrl(citationBaseUrl(baseUrl), {
    datasourceUid,
    datasourceType,
    query,
    from: grafanaFromTime(start),
    to: end,
  });
  const citations: Citation[] = [];
  const seen = new Set<string>();
  pushExternalCitation(citations, seen, url, grafanaCitationLabel("logs", query));
  return okCited(result, citations);
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
): Promise<{ content: string; citations?: Citation[] }> {
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
  if (results.length === 0) return { content: "No data returned for this query." };

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

  // Read datasource uid/type from params (defaults match the xyne Grafana's
  // VictoriaMetrics datasource) so callers can override per-instance — fixes
  // the inconsistency the logs handler already had.
  const datasourceUid = (params["datasourceUid"] as string | undefined) ?? "victoria-metrics";
  const datasourceType = (params["datasourceType"] as string | undefined) ?? "victoriametrics-datasource";
  const url = buildGrafanaExploreUrl(citationBaseUrl(baseUrl), {
    datasourceUid,
    datasourceType,
    query,
    from: start,
    to: end,
  });
  const citations: Citation[] = [];
  const seen = new Set<string>();
  pushExternalCitation(citations, seen, url, grafanaCitationLabel("metrics", query));
  return okCited(output, citations);
}

export async function handleGrafanaQueryDatabase(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const baseUrl = credentials["url"] as string;
  const token = credentials["token"] as string;

  const datasourceUid = params["datasourceUid"] as string | undefined;
  const datasourceType = params["datasourceType"] as string | undefined;
  const sql = (params["sql"] as string).trim();
  const timeRange = (params["timeRange"] as string) || "1h";

  if (!datasourceUid || !datasourceType) {
    return { content: "Error: datasourceUid and datasourceType are required. Call list_datasources first to discover them." };
  }
  if (!/^(SELECT|WITH)\b/i.test(sql)) return { content: "Error: Only SELECT (or WITH ... SELECT) queries are allowed." };
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|ATTACH|DETACH|OPTIMIZE)\b/i.test(sql)) {
    return { content: "Error: Write/DDL operations are not allowed." };
  }

  const res = await grafanaFetch(baseUrl, token, "/api/ds/query", {
    method: "POST",
    body: JSON.stringify({
      queries: [{
        refId: "A",
        datasource: { uid: datasourceUid, type: datasourceType },
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
  if (!frame) return { content: "No results returned." };

  const columns = frame.schema?.fields?.map((f) => f.name) ?? [];
  const values = frame.data?.values ?? [];
  if (columns.length === 0) return { content: "Empty result set." };

  const rowCount = values[0]?.length ?? 0;
  let output = `**Query:** \`${sql}\`\n**Rows:** ${rowCount}\n\n`;
  output += `| ${columns.join(" | ")} |\n`;
  output += `| ${columns.map(() => "---").join(" | ")} |\n`;

  for (let r = 0; r < Math.min(rowCount, 50); r++) {
    const row = columns.map((_, c) => String(values[c]?.[r] ?? ""));
    output += `| ${row.join(" | ")} |\n`;
  }
  if (rowCount > 50) output += `\n... and ${rowCount - 50} more rows`;

  // SQL Explore deep-links are plugin-dependent; rawSql is used for SQL
  // datasources. Where the plugin ignores it the link still opens Explore on
  // the right datasource. The SQL is data only (F1).
  const url = buildGrafanaExploreUrl(citationBaseUrl(baseUrl), {
    datasourceUid,
    datasourceType,
    query: sql,
    from: `now-${timeRange}`,
    to: "now",
  });
  const citations: Citation[] = [];
  const seen = new Set<string>();
  pushExternalCitation(citations, seen, url, grafanaCitationLabel("sql", sql));
  return okCited(output, citations);
}
