import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";

const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "attio",
  label: "Attio",
  registerUrl: "https://app.attio.com/oauth/register",
  authUrl: "https://app.attio.com/oidc/authorize",
  tokenUrl: "https://app.attio.com/oidc/token",
  confidential: false,
  scope: "mcp offline_access",
  server: {
    name: "Attio",
    url: "https://mcp.attio.com/mcp",
    description: "Attio integration — manage CRM records, contacts, companies, deals, tasks, notes, and meetings.",
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
  },
});

export const attioOAuthRouter = router;
export const attioCallbackRouter = callbackRouter;
export const attioOAuthProvider = provider;
