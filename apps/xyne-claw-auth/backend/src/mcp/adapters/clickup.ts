import type { HttpMcpAdapter } from "../types.js";

/**
 * ClickUp MCP adapter.
 *
 * ClickUp MCP is a fully hosted HTTP endpoint at https://mcp.clickup.com/mcp.
 * Auth: OAuth 2.1 with DCR + PKCE (public client, token_endpoint_auth_method:
 * none) — confirmed against ClickUp's own discovery document. The stored
 * credentials contain { clientId, accessToken, refreshToken, expires }; we
 * pass the access token as a Bearer header.
 *
 * OAuth discovery: https://mcp.clickup.com/.well-known/oauth-authorization-server
 *   issuer:                  https://mcp.clickup.com
 *   authorization_endpoint:  https://mcp.clickup.com/oauth/authorize
 *   token_endpoint:          https://mcp.clickup.com/oauth/token
 *   registration_endpoint:   https://mcp.clickup.com/oauth/register
 *   token_endpoint_auth:     none (public client)
 *   PKCE:                    S256
 *
 * There is no long-lived personal-access-token flow for this server — a
 * manually pasted "Bearer token" (as a self-serve form field would collect)
 * is not how a user obtains one in the first place, and it wouldn't refresh.
 * See routes/clickup-oauth.ts for the flow.
 */
export const clickupAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "clickup",
  // No form fields — connection is created exclusively via the OAuth flow.
  credentialFields: [],
  // tools/list-based probe: ClickUp doesn't publish a canonical parameter-free
  // read tool name in its docs, so fall back to the generic list-tools sentinel
  // (see health.ts) rather than guess a tool identifier that might not exist.
  healthCheck: { name: "__list_tools__", params: {} },
  // Left empty deliberately — ClickUp's docs (developer.clickup.com/docs/mcp-tools)
  // only publish human-readable titles ("Create Task", "Delete task", ...), not
  // the machine tool identifiers tools/list actually returns. Populate this
  // allowlist from a live tools/list call once connected.
  writeTools: [],
  buildHttpUrl(credentials) {
    return {
      url: "https://mcp.clickup.com/mcp",
      headers: {
        Authorization: `Bearer ${String(credentials["accessToken"] ?? "")}`,
      },
    };
  },
};
