import type { HttpMcpAdapter } from "../types.js";

/**
 * Wix MCP adapter.
 *
 * Wix MCP is a fully hosted HTTP endpoint at https://mcp.wix.com/mcp.
 * Auth: OAuth 2.1 with DCR + PKCE (public client, token_endpoint_auth_method: none).
 * The stored credentials contain { clientId, accessToken, refreshToken, expires }.
 * We pass the access token as a Bearer header.
 *
 * OAuth discovery: https://mcp.wix.com/.well-known/oauth-authorization-server
 *   issuer:                  https://mcp.wix.com
 *   authorization_endpoint:  https://mcp.wix.com/authorize
 *   token_endpoint:          https://mcp.wix.com/token
 *   registration_endpoint:   https://mcp.wix.com/register
 *   token_endpoint_auth:     none (public client)
 *   PKCE:                    S256
 */
export const wixAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "wix",
  // No form fields — connection is created exclusively via the OAuth flow.
  credentialFields: [],
  healthCheck: { name: "ListWixSites", params: {} },
  writeTools: [
    "CallWixSiteAPI",
    "CreateWixBusinessGuide",
    "ExecuteWixAPI",
    "ManageWixSite",
    "UploadImageToWixSite",
    "WixSiteBuilder",
    "pullSiteCreationJob",
  ],
  buildHttpUrl(credentials) {
    return {
      url: "https://mcp.wix.com/mcp",
      headers: {
        Authorization: "Bearer " + String(credentials["accessToken"] ?? ""),
      },
    };
  },
};
