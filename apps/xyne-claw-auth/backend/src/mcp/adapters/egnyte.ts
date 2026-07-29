import type { HttpMcpAdapter } from "../types.js";

/**
 * Egnyte MCP adapter.
 *
 * Egnyte MCP is a fully hosted HTTP endpoint at https://mcp-server.egnyte.com/mcp.
 * Auth: standard OAuth 2.0 Authorization Code Grant with a pre-registered
 * App API Key. The stored credentials contain { accessToken, refreshToken, domain, expires }.
 * We pass the access token as a Bearer header.
 *
 * The domain is stored in credentials but the MCP server URL is fixed — Egnyte's
 * MCP server is centrally hosted and resolves the user's domain from the token.
 */
export const egnyteAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "egnyte",
  credentialFields: [],
  healthCheck: { name: "list_filesystem_by_path", params: { path: "/" } },
  writeTools: [
    "create_folder",
    "upload_file",
    "set_file_metadata",
    "create_comment",
    "create_link",
  ],
  buildHttpUrl(credentials) {
    const accessToken = credentials["accessToken"];
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new Error("Egnyte credentials missing accessToken");
    }
    return {
      url: "https://mcp-server.egnyte.com/mcp",
      headers: { Authorization: `Bearer ${accessToken}` },
    };
  },
};
