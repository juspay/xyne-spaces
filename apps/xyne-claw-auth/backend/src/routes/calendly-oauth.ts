import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";

const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "calendly",
  label: "Calendly",
  registerUrl: "https://calendly.com/oauth/register",
  authUrl: "https://calendly.com/oauth/authorize",
  tokenUrl: "https://calendly.com/oauth/token",
  confidential: false,
  server: {
    name: "Calendly",
    url: "https://mcp.calendly.com",
    description: "Calendly scheduling integration — manage event types, availability, and bookings.",
    writeToolPolicy: {
      mode: "allowlist",
      tools: [
        "event_types-create_event_type",
        "event_types-update_event_type",
        "event_types-update_event_type_availability_schedule",
        "meetings-cancel_event",
        "meetings-create_invitee",
        "meetings-create_invitee_no_show",
        "meetings-delete_invitee_no_show",
        "scheduling_links-create_single_use_scheduling_link",
        "shares-create_share",
        "organizations-create_organization_invitation",
        "organizations-revoke_organization_invitation",
        "organizations-delete_organization_membership",
      ],
    },
    healthcheckSpec: { name: "users-get_current_user", params: {} },
  },
});

export const calendlyOAuthRouter = router;
export const calendlyCallbackRouter = callbackRouter;
export const calendlyOAuthProvider = provider;
