import type { HttpMcpAdapter } from "../types.js";

/**
 * Mixpanel hosted MCP (US region) — Streamable HTTP at https://mcp.mixpanel.com/mcp.
 * Auth: OAuth 2.1 with DCR + PKCE (public client); handled by
 * routes/mixpanel-remote-oauth.ts, which stores { clientId, accessToken,
 * refreshToken, expires }. The service-account `mixpanel` connector (stdio
 * `@mercuryml/mcp-mixpanel`) stays as-is alongside this one.
 *
 * OAuth discovery: https://mcp.mixpanel.com/.well-known/oauth-authorization-server
 *   authorization_endpoint:  https://mixpanel.com/oauth/authorize
 *   token_endpoint:          https://mixpanel.com/oauth/token/
 *   registration_endpoint:   https://mixpanel.com/oauth/mcp/register/
 *   token_endpoint_auth:     none | client_secret_basic | client_secret_post
 *   PKCE:                    S256
 *
 * EU (mcp-eu.mixpanel.com) and IN (mcp-in.mixpanel.com) orgs have their own
 * endpoints and are not covered by this connector. An org admin must enable
 * MCP in Mixpanel (Settings → Org → Overview) before users can connect.
 */
export const mixpanelRemoteAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "mixpanel-remote",
  credentialFields: [],
  healthCheck: { name: "Get-Projects", params: {} },
  writeTools: [
    "Create-Dashboard",
    "Update-Dashboard",
    "Duplicate-Dashboard",
    "Delete-Dashboard",
    "Edit-Event",
    "Edit-Property",
    "Bulk-Edit-Events",
    "Bulk-Edit-Properties",
    "Create-Tag",
    "Rename-Tag",
    "Delete-Tag",
    "Dismiss-Issues",
    "Dismiss-Duplicate-Group",
    "Merge-Group",
    "Update-Business-Context",
    "Create-Custom-Property",
    "Update-Custom-Property",
    "Create-Cohort",
    "Update-Cohort",
    "Delete-Cohort",
    "Create-Lookup-Table",
    "Update-Lookup-Table",
    "Create-Metric",
    "Update-Metric",
    "Create-Experiment",
    "Update-Experiment",
    "Create-Feature-Flag",
    "Update-Feature-Flag",
  ],
  buildHttpUrl(credentials) {
    const accessToken = credentials["accessToken"];
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new Error("Mixpanel credentials missing accessToken");
    }
    return {
      url: "https://mcp.mixpanel.com/mcp",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };
  },
};
