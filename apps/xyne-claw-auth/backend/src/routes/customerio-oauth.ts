import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";

const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "customerio",
  label: "Customer.io",
  registerUrl: "https://mcp.customer.io/oauth2/register",
  authUrl: "https://mcp.customer.io/oauth2/authorize",
  tokenUrl: "https://mcp.customer.io/oauth2/token",
  confidential: false,
  server: {
    name: "Customer.io",
    url: "https://mcp.customer.io/mcp",
    description:
      "Customer.io — generate segments, inspect customer profiles, search your workspace, and analyze campaigns using real data.",
    writeToolPolicy: {
      mode: "allowlist",
      tools: ["cio_write_api", "cio_delete_api"],
    },
    healthcheckSpec: { name: "__list_tools__", params: {} },
  },
});

export const customerioOAuthRouter = router;
export const customerioCallbackRouter = callbackRouter;
export const customerioOAuthProvider = provider;
