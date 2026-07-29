import type { HttpMcpAdapter } from "../types.js";

/**
 * Calendly MCP adapter.
 *
 * Calendly MCP is a fully hosted HTTP server at https://mcp.calendly.com.
 * Auth is OAuth 2.1 with DCR + PKCE — handled by the calendly-oauth routes.
 * The stored credentials contain { clientId, accessToken, refreshToken, expires }.
 * We simply pass the access token as a Bearer header here.
 *
 * Tool names exposed by mcp.calendly.com are namespaced as `<resource>-<action>`
 * (see https://developer.calendly.com/supported-tools). The `writeTools` list
 * below MUST match those exact names — `routes/mcp.ts` uses an `.includes(tool)`
 * check to force the "ask" approval gate, so any mismatch causes write tools
 * to execute silently without user confirmation. Keep this list in sync with
 * the canonical seed in `routes/calendly-oauth.ts → ensureCalendlyServer`.
 */
export const calendlyAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "calendly",
  // No form fields — connection is created exclusively via the OAuth flow.
  credentialFields: [],
  // `users-get_current_user` is parameter-free and is the canonical Calendly
  // "who am I" probe. We avoid `event_types-list_event_types` here because it
  // mandates either a `user` or `organization` URI param, which we don't have
  // until we've already called `users-get_current_user`.
  healthCheck: { name: "users-get_current_user", params: {} },
  writeTools: [
    // Event types
    "event_types-create_event_type",
    "event_types-update_event_type",
    "event_types-update_event_type_availability_schedule",
    // Meetings
    "meetings-cancel_event",
    "meetings-create_invitee",
    "meetings-create_invitee_no_show",
    "meetings-delete_invitee_no_show",
    // Scheduling links / shares
    "scheduling_links-create_single_use_scheduling_link",
    "shares-create_share",
    // Organization management
    "organizations-create_organization_invitation",
    "organizations-revoke_organization_invitation",
    "organizations-delete_organization_membership",
  ],
  buildHttpUrl(credentials) {
    return {
      url: "https://mcp.calendly.com",
      headers: {
        Authorization: `Bearer ${String(credentials["accessToken"] ?? "")}`,
      },
    };
  },
};
