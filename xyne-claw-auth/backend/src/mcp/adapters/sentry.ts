import type { StdioMcpAdapter } from "../types.js";

/**
 * Sentry MCP — official `@sentry/mcp-server`. Replaces the two legacy self-serve
 * connectors after the stdio-launchConfig lockdown: `sentry` (stored the token as
 * `apiKey`) and `sentry-mcp` (stored it as `sentryAccessToken`). One adapter,
 * registered for both types; buildCommand reads whichever key is present so
 * existing creds keep working with no reconnect. New connections use `accessToken`.
 */
export const sentryAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "sentry",
  healthCheck: { name: "whoami", params: {} },
  writeTools: [
    "create_issue", "update_issue", "resolve_issue",
    "create_project", "create_team", "create_dsn",
  ],
  credentialFields: [
    { name: "accessToken", label: "Sentry User Access Token", type: "password", placeholder: "sntrys_..." },
  ],
  buildCommand(credentials) {
    const token = String(
      credentials["accessToken"] ?? credentials["sentryAccessToken"] ?? credentials["apiKey"] ?? "",
    );
    return {
      cmd: "npx",
      args: ["-y", "@sentry/mcp-server@0.36.0", `--access-token=${token}`],
      env: {},
    };
  },
};
