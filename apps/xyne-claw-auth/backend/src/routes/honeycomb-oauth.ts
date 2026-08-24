import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";

const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "honeycomb",
  label: "Honeycomb",
  registerUrl: "https://ui.honeycomb.io/oauth/register",
  authUrl: "https://ui.honeycomb.io/oauth/authorize",
  tokenUrl: "https://ui.honeycomb.io/oauth/token",
  confidential: false,
  scope: "mcp:read mcp:write",
  dcrScope: "mcp:read mcp:write",
  server: {
    name: "Honeycomb",
    url: "https://mcp.honeycomb.io/mcp",
    description: "Honeycomb observability — query traces, investigate anomalies, monitor SLOs and Triggers.",
    writeToolPolicy: {
      mode: "allowlist",
      tools: ["create_board"],
    },
    healthcheckSpec: { name: "get_workspace_context", params: {} },
  },
});

export const honeycombOAuthRouter = router;
export const honeycombCallbackRouter = callbackRouter;
export const honeycombOAuthProvider = provider;
