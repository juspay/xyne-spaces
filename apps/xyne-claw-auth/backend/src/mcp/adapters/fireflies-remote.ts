import type { HttpMcpAdapter } from "../types.js";

/**
 * Fireflies hosted MCP — Streamable HTTP at https://api.fireflies.ai/mcp.
 * Auth: OAuth 2.1 with DCR + PKCE (public client); handled by
 * routes/fireflies-remote-oauth.ts, which stores { clientId, accessToken,
 * refreshToken, expires }.
 *
 * OAuth discovery: https://api.fireflies.ai/.well-known/oauth-authorization-server
 *   authorization_endpoint:  https://api.fireflies.ai/authorize
 *   token_endpoint:          https://api.fireflies.ai/token
 *   registration_endpoint:   https://api.fireflies.ai/register
 *   token_endpoint_auth:     none | client_secret_post
 *   scopes:                  profile email
 *   PKCE:                    S256
 *
 * Tools: https://docs.fireflies.ai/mcp-tools/overview
 */
export const firefliesRemoteAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "fireflies-remote",
  credentialFields: [],
  healthCheck: { name: "fireflies_get_user", params: {} },
  writeTools: [
    "fireflies_share_meeting",
    "fireflies_revoke_meeting_access",
    "fireflies_update_meeting_title",
    "fireflies_move_meeting",
    "fireflies_create_soundbite",
  ],
  buildHttpUrl(credentials) {
    const accessToken = credentials["accessToken"];
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new Error("Fireflies credentials missing accessToken");
    }
    return {
      url: "https://api.fireflies.ai/mcp",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };
  },
};
