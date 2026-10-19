import type { HttpMcpAdapter } from "../types.js";

/**
 * Sentry hosted MCP — Streamable HTTP at https://mcp.sentry.dev/mcp.
 * Auth: OAuth 2.1 with DCR + PKCE (public client); handled by
 * routes/sentry-remote-oauth.ts, which stores { clientId, accessToken,
 * refreshToken, expires }. The pasted-token `sentry` connector (stdio
 * `@sentry/mcp-server`) stays as-is alongside this one.
 *
 * OAuth discovery: https://mcp.sentry.dev/.well-known/oauth-authorization-server
 *   authorization_endpoint:  https://mcp.sentry.dev/oauth/authorize
 *   token_endpoint:          https://mcp.sentry.dev/oauth/token
 *   registration_endpoint:   https://mcp.sentry.dev/oauth/register
 *   token_endpoint_auth:     none | client_secret_basic | client_secret_post
 *   PKCE:                    S256
 *
 * The client `scope` is not used: the user picks permissions ("skills") on
 * Sentry's consent screen, and the server maps them to Sentry API scopes.
 */
export const sentryRemoteAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "sentry-remote",
  credentialFields: [],
  // The hosted server doesn't expose `whoami` (the stdio package does);
  // find_organizations is always present and only needs org:read.
  healthCheck: { name: "find_organizations", params: {} },
  writeTools: [
    "add_issue_note",
    "add_team_to_project",
    "analyze_issue_with_seer",
    "create_alert_rule",
    "create_dsn",
    "create_metric_monitor",
    "create_project",
    "create_team",
    "create_uptime_monitor",
    "delete_alert_rule",
    "delete_metric_monitor",
    "delete_monitor_environment",
    "delete_uptime_monitor",
    // Proxy that can invoke any other Sentry tool, write ones included.
    "execute_sentry_tool",
    "link_issue",
    "onboarding_status_update",
    "remove_team_from_project",
    "unlink_issue",
    "update_alert_rule",
    "update_dsn",
    "update_issue",
    "update_metric_monitor",
    "update_project",
    "update_uptime_monitor",
  ],
  buildHttpUrl(credentials) {
    const accessToken = credentials["accessToken"];
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new Error("Sentry credentials missing accessToken");
    }
    return {
      url: "https://mcp.sentry.dev/mcp",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };
  },
};
