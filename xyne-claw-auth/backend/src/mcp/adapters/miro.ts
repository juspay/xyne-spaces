import type { HttpMcpAdapter } from "../types.js";

/**
 * Miro MCP adapter.
 *
 * Miro MCP is a fully hosted HTTP endpoint at https://mcp.miro.com/.
 * Auth: OAuth 2.1 with DCR + PKCE (confidential client — server issues a
 * client_secret during registration). The stored credentials contain
 * { clientId, clientSecret, accessToken, refreshToken, expires }.
 * We pass the access token as a Bearer header.
 *
 * OAuth discovery: https://mcp.miro.com/.well-known/oauth-authorization-server
 */
export const miroAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "miro",
  // No form fields — connection is created exclusively via the OAuth flow.
  credentialFields: [],
  // `board_search_boards` is parameter-free and is the canonical Miro "who am I" probe.
  healthCheck: { name: "board_search_boards", params: {} },
  writeTools: [
    "diagram_create",
    "doc_create",
    "doc_update",
    "table_create",
    "table_sync_rows",
    "board_create",
    "image_create",
    "image_get_upload_url",
    "code_widget_create",
    "code_widget_delete",
    "code_widget_update",
    "comment_reply",
    "comment_resolve",
    "layout_create",
    "layout_update",
  ],
  buildHttpUrl(credentials) {
    return {
      url: "https://mcp.miro.com/",
      headers: {
        Authorization: `Bearer ${String(credentials["accessToken"] ?? "")}`,
      },
    };
  },
};
