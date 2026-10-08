import type { HttpMcpAdapter } from "../types.js";

/**
 * Notion hosted MCP — Streamable HTTP at https://mcp.notion.com/mcp.
 * Auth: OAuth 2.1 with DCR + PKCE (public client, token_endpoint_auth_method:
 * none); an internal `ntn_` integration token is NOT accepted here — that one
 * belongs to the stdio `notion` connector. Stored credentials come from
 * routes/notion-remote-oauth.ts as { clientId, accessToken, refreshToken,
 * expires }.
 *
 * OAuth discovery: https://mcp.notion.com/.well-known/oauth-authorization-server
 *   issuer:                  https://mcp.notion.com
 *   authorization_endpoint:  https://mcp.notion.com/authorize
 *   token_endpoint:          https://mcp.notion.com/token
 *   registration_endpoint:   https://mcp.notion.com/register
 *   token_endpoint_auth:     none (public client)
 *   PKCE:                    S256
 */
export const notionRemoteAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "notion-remote",
  credentialFields: [],
  healthCheck: { name: "notion-get-teams", params: {} },
  writeTools: [
    "notion-create-file-upload",
    "notion-create-attachment",
    "notion-create-pages",
    "notion-update-page",
    "notion-convert-page-to-skill",
    "notion-move-pages",
    "notion-duplicate-page",
    "notion-create-database",
    "notion-create-folder",
    "notion-update-data-source",
    "notion-create-view",
    "notion-update-view",
    "notion-create-comment",
    "notion-spawn-session",
    "notion-send-message-to-session",
    "notion-wait-session",
    "notion-stop-session",
  ],
  buildHttpUrl(credentials) {
    return {
      url: "https://mcp.notion.com/mcp",
      headers: {
        Authorization: `Bearer ${String(credentials["accessToken"] ?? "")}`,
      },
    };
  },
};
