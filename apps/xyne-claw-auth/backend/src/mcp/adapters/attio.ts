import type { HttpMcpAdapter } from "../types.js";

/**
 * Attio MCP adapter.
 *
 * Attio MCP is a fully hosted HTTP endpoint at https://mcp.attio.com/mcp.
 * Auth: OAuth 2.1 with DCR + PKCE (public client, token_endpoint_auth_method: none).
 * The stored credentials contain { clientId, accessToken, refreshToken, expires }.
 * We pass the access token as a Bearer header.
 *
 * OAuth discovery: https://mcp.attio.com/.well-known/oauth-authorization-server
 *   issuer:                  https://app.attio.com
 *   authorization_endpoint:  https://app.attio.com/oidc/authorize
 *   token_endpoint:          https://app.attio.com/oidc/token
 *   registration_endpoint:   https://app.attio.com/oauth/register
 *   token_endpoint_auth:     none (public client)
 *   PKCE:                    S256
 */
export const attioAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "attio",
  // No form fields — connection is created exclusively via the OAuth flow.
  credentialFields: [],
  // whoami is parameter-free and returns current user info
  healthCheck: { name: "whoami", params: {} },
  writeTools: [
    "add-record-to-list",
    "create-comment",
    "create-note",
    "create-record",
    "create-task",
    "delete-comment",
    "update-list",
    "update-list-entry-by-id",
    "update-list-entry-by-record-id",
    "update-note",
    "update-record",
    "update-task",
    "upsert-record",
  ],
  buildHttpUrl(credentials) {
    return {
      url: "https://mcp.attio.com/mcp",
      headers: {
        Authorization: `Bearer ${String(credentials["accessToken"] ?? "")}`,
      },
    };
  },
};
