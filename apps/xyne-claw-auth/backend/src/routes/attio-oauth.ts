/**
 * Attio OAuth routes for xyne-claw-auth.
 *
 * Attio MCP uses OAuth 2.1 with Dynamic Client Registration (DCR, RFC 7591)
 * and PKCE (S256). It is a public client (token_endpoint_auth_method: none) —
 * no pre-registered client_id / client_secret, identical pattern to Calendly,
 * JotForm, Webflow, and Wix.
 *
 * Discovery: https://mcp.attio.com/.well-known/oauth-authorization-server
 *   issuer:                  https://app.attio.com
 *   authorization_endpoint:  https://app.attio.com/oidc/authorize
 *   token_endpoint:          https://app.attio.com/oidc/token
 *   registration_endpoint:   https://app.attio.com/oauth/register
 *   token_endpoint_auth:     none (public client)
 *   PKCE:                    S256
 *   Scopes:                  mcp offline_access
 *
 * The DCR + PKCE + signed-state + refresh skeleton lives in
 * lib/dcr-oauth-flow.ts; this file supplies only Attio's config and re-exports
 * the three symbols main.ts / oauth-token.ts already import.
 */

import { buildDcrOAuthFlow } from "../lib/dcr-oauth-flow.js";

const attioFlow = buildDcrOAuthFlow({
  provider: "attio",
  label: "Attio",
  registerUrl: "https://app.attio.com/oauth/register",
  authUrl: "https://app.attio.com/oidc/authorize",
  tokenUrl: "https://app.attio.com/oidc/token",
  scope: "mcp offline_access",
  serverSpec: {
    type: "attio",
    name: "Attio",
    url: "https://mcp.attio.com/mcp",
    description:
      "Attio integration — manage CRM records, contacts, companies, deals, tasks, notes, and meetings.",
    transport: "http",
    writeToolPolicy: {
      mode: "allowlist",
      tools: [
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
    },
    healthcheckSpec: { name: "whoami", params: {} },
    connectorMeta: { scope: "global", mode: "self-serve" },
  },
});

export const attioOAuthRouter = attioFlow.oauthRouter;
export const attioCallbackRouter = attioFlow.callbackRouter;
export const attioOAuthProvider = attioFlow.tokenProvider;
