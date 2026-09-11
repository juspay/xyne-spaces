import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";

const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "mailerlite",
  label: "MailerLite",
  registerUrl: "https://mcp.mailerlite.com/register",
  authUrl: "https://mcp.mailerlite.com/authorize",
  tokenUrl: "https://mcp.mailerlite.com/token",
  confidential: false,
  server: {
    name: "MailerLite",
    url: "https://mcp.mailerlite.com/mcp",
    description: "MailerLite integration — manage email campaigns, subscribers, groups, automations, and forms.",
    writeToolPolicy: {
      mode: "allowlist",
      tools: [
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
    },
    healthcheckSpec: { name: "get_auth_status", params: {} },
  },
});

export const mailerliteOAuthRouter = router;
export const mailerliteCallbackRouter = callbackRouter;
export const mailerliteOAuthProvider = provider;
