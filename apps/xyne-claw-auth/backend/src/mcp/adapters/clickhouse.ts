import type { StdioMcpAdapter } from "../types.js";

/**
 * ClickHouse MCP — read-only SQL access over the official `mcp-clickhouse`
 * server (Python, run via uvx). Replaces the legacy self-serve `clickhouse`
 * connector after the stdio-launchConfig lockdown; credential keys + env var
 * names match what those connections already stored (host/port/user/password
 * → CLICKHOUSE_*), so existing creds keep working with no reconnect.
 */
export const clickhouseAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "clickhouse",
  healthCheck: { name: "list_databases", params: {} },
  credentialFields: [
    { name: "host", label: "ClickHouse Host", type: "text", placeholder: "your-host.clickhouse.cloud", optional: true },
    { name: "port", label: "Port", type: "text", placeholder: "8443", optional: true },
    { name: "user", label: "Username", type: "text", placeholder: "default", optional: true },
    { name: "password", label: "Password", type: "password", placeholder: "", optional: true },
  ],
  buildCommand(credentials) {
    const host = String(credentials["host"] ?? "").trim();
    const port = String(credentials["port"] ?? "").trim();
    const user = String(credentials["user"] ?? "").trim();
    const password = String(credentials["password"] ?? "");

    // SECURE/VERIFY default on — the legacy connector hardcoded both to "true".
    const env: Record<string, string> = {
      CLICKHOUSE_SECURE: "true",
      CLICKHOUSE_VERIFY: "true",
    };
    if (host) env["CLICKHOUSE_HOST"] = host;
    if (port) env["CLICKHOUSE_PORT"] = port; // legacy template appended a stray space; trimmed here
    if (user) env["CLICKHOUSE_USER"] = user;
    if (password) env["CLICKHOUSE_PASSWORD"] = password;

    return { cmd: "uvx", args: ["mcp-clickhouse==0.4.0"], env };
  },
};
