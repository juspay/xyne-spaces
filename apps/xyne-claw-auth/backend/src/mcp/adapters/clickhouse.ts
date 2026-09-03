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
    { name: "secure", label: "Use TLS (secure)", type: "text", placeholder: "true", optional: true },
    { name: "verify", label: "Verify TLS cert", type: "text", placeholder: "true", optional: true },
  ],
  buildCommand(credentials) {
    // Strip any scheme/trailing slash a user may have pasted into the host
    // field (prevents the mangled `https://http://host:port` seen in logs).
    const host = String(credentials["host"] ?? "")
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "");
    const port = String(credentials["port"] ?? "").trim();
    const user = String(credentials["user"] ?? "").trim();
    const password = String(credentials["password"] ?? "");

    // SECURE/VERIFY default on (matches legacy behaviour) but are now
    // credential-driven so plaintext-HTTP servers (e.g. port 8123) can opt out
    // by setting secure="false". Only an explicit "false" disables them.
    const secure =
      String(credentials["secure"] ?? "true").trim().toLowerCase() === "false" ? "false" : "true";
    const verify =
      String(credentials["verify"] ?? "true").trim().toLowerCase() === "false" ? "false" : "true";
    const env: Record<string, string> = {
      CLICKHOUSE_SECURE: secure,
      CLICKHOUSE_VERIFY: verify,
    };
    if (host) env["CLICKHOUSE_HOST"] = host;
    if (port) env["CLICKHOUSE_PORT"] = port; // legacy template appended a stray space; trimmed here
    if (user) env["CLICKHOUSE_USER"] = user;
    if (password) env["CLICKHOUSE_PASSWORD"] = password;

    return { cmd: "uvx", args: ["mcp-clickhouse==0.4.0"], env };
  },
};
