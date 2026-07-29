import type { HttpMcpAdapter } from "../types.js";

/**
 * Customer.io MCP adapter.
 *
 * Customer.io MCP is a fully hosted HTTP server at https://mcp.customer.io/mcp.
 * Auth is OAuth 2.1 with DCR + PKCE — handled by the customerio-oauth routes.
 * The stored credentials contain { clientId, accessToken, refreshToken, expires }.
 * We pass the access token as a Bearer header here.
 *
 * Token auth method: none (public client — no client_secret).
 *
 * Tools (8 total):
 *   Read:  cio_auth_status, cio_prime, cio_read_api, cio_schema,
 *          cio_skills_list, cio_skills_read
 *   Write: cio_write_api, cio_delete_api
 */
export const customerioAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "customerio",
  // No form fields — connection is created exclusively via the OAuth flow.
  credentialFields: [],
  // __list_tools__ verifies auth end-to-end; all c.io tools require parameters.
  healthCheck: { name: "__list_tools__", params: {} },
  writeTools: ["cio_write_api", "cio_delete_api"],
  buildHttpUrl(credentials) {
    const accessToken = credentials["accessToken"];
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new Error("Customer.io credentials missing accessToken");
    }
    return {
      url: "https://mcp.customer.io/mcp",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };
  },
};
