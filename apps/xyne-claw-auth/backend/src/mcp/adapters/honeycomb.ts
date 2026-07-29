import type { HttpMcpAdapter } from "../types.js";

/**
 * Honeycomb MCP adapter.
 *
 * Honeycomb MCP is a fully hosted HTTP server at https://mcp.honeycomb.io/mcp.
 * Auth is OAuth 2.1 with DCR + PKCE — handled by the honeycomb-oauth routes.
 * The stored credentials contain { clientId, accessToken, refreshToken, expires }.
 * We pass the access token as a Bearer header here.
 *
 * Protected resource discovery:
 *   GET https://mcp.honeycomb.io/.well-known/oauth-protected-resource
 *   → { resource: "https://mcp.honeycomb.io/mcp",
 *       authorization_servers: ["https://ui.honeycomb.io"],
 *       scopes_supported: ["mcp:read","mcp:write"],
 *       bearer_methods_supported: ["header"] }
 *
 * The only write-gated tool is `create_board` (requires the mcp:write scope).
 * All other tools are read-only (mcp:read).
 */
export const honeycombAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "honeycomb",
  // No form fields — connection is created exclusively via the OAuth flow.
  credentialFields: [],
  // get_workspace_context is parameter-free and is Honeycomb's canonical
  // "call this first" probe — it returns teams/environments metadata.
  healthCheck: { name: "get_workspace_context", params: {} },
  writeTools: [
    // The only write operation in Honeycomb MCP — requires mcp:write scope.
    "create_board",
  ],
  buildHttpUrl(credentials) {
    const accessToken = credentials["accessToken"];
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new Error("Honeycomb credentials missing accessToken");
    }
    return {
      url: "https://mcp.honeycomb.io/mcp",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };
  },
};
