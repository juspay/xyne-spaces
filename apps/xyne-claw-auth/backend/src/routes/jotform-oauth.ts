import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";

const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "jotform",
  label: "JotForm",
  registerUrl: "https://oauth2.jotform.com/register-public-client",
  authUrl: "https://oauth2.jotform.com/authorize",
  tokenUrl: "https://oauth2.jotform.com/token",
  confidential: false,
  scope: "full",
  server: {
    name: "JotForm",
    url: "https://mcp.jotform.com",
    description: "JotForm integration — build forms, capture submissions, and manage your workspace.",
    writeToolPolicy: {
      mode: "allowlist",
      tools: [
        "create_form",
        "edit_form",
        "create_submission",
      ],
    },
    healthcheckSpec: { name: "form_list", params: {} },
  },
});

export const jotformOAuthRouter = router;
export const jotformCallbackRouter = callbackRouter;
export const jotformOAuthProvider = provider;
