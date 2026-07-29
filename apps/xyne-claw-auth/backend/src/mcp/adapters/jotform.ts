import type { HttpMcpAdapter } from "../types.js";

/**
 * JotForm MCP adapter.
 *
 * JotForm MCP is a fully hosted HTTP server at https://mcp.jotform.com.
 * Auth is OAuth 2.1 with DCR + PKCE — handled by the jotform-oauth routes.
 * The stored credentials contain { clientId, accessToken, refreshToken, expires }.
 * We simply pass the access token as a Bearer header here.
 *
 * OAuth discovery: https://mcp.jotform.com/.well-known/oauth-authorization-server
 */
export const jotformAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "jotform",
  // No form fields — connection is created exclusively via the OAuth flow.
  credentialFields: [],
  // `form_list` is parameter-free and is the canonical JotForm "who am I" probe.
  healthCheck: { name: "form_list", params: {} },
  writeTools: [
    "create_form",
    "edit_form",
    "create_submission",
  ],
  buildHttpUrl(credentials) {
    return {
      url: "https://mcp.jotform.com",
      headers: {
        Authorization: `Bearer ${String(credentials["accessToken"] ?? "")}`,
      },
    };
  },
};
