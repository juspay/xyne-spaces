import type { HttpMcpAdapter } from "../types.js";

/**
 * MailerLite MCP adapter.
 *
 * MailerLite MCP is a fully hosted HTTP endpoint at https://mcp.mailerlite.com/mcp.
 * Auth: OAuth 2.0 (login flow via MailerLite).
 * The stored credentials contain { accessToken, refreshToken, expires }.
 * We pass the access token as a Bearer header.
 *
 * Docs: https://developers.mailerlite.com/mcp/
 */
export const mailerliteAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "mailerlite",
  // No form fields — connection is created exclusively via the OAuth flow.
  credentialFields: [],
  // get_auth_status is the canonical MailerLite health probe.
  healthCheck: { name: "get_auth_status", params: {} },
  writeTools: [
    "add_subscriber",
    "update_subscriber",
    "delete_subscriber",
    "forget_subscriber",
    "create_campaign",
    "update_campaign",
    "delete_campaign",
    "schedule_campaign",
    "cancel_campaign",
    "create_group",
    "update_group",
    "delete_group",
    "assign_subscriber_to_group",
    "unassign_subscriber_from_group",
    "import_subscribers_to_group",
    "create_webhook",
    "update_webhook",
    "delete_webhook",
    "update_segment",
    "delete_segment",
    "create_automation",
    "delete_automation",
    "update_form",
    "delete_form",
  ],
  buildHttpUrl(credentials) {
    return {
      url: "https://mcp.mailerlite.com/mcp",
      headers: {
        Authorization: "Bearer " + String(credentials["accessToken"] ?? ""),
      },
    };
  },
};
