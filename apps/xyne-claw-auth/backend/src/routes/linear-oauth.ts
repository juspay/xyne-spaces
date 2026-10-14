import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";
import { LINEAR_READ_TOOLS } from "../mcp/adapters/linear.js";

// Linear's hosted MCP server advertises OAuth 2.1 with DCR + PKCE (S256) at
// https://mcp.linear.app/.well-known/oauth-authorization-server — no client id
// or secret to provision. Scopes `read` / `write`; a token granted only `read`
// cannot reach write APIs.
const { router, callbackRouter, provider, ensureServer } = createMcpOAuthProvider({
  type: "linear",
  label: "Linear",
  registerUrl: "https://mcp.linear.app/register",
  authUrl: "https://mcp.linear.app/authorize",
  tokenUrl: "https://mcp.linear.app/token",
  confidential: false,
  scope: "read write",
  server: {
    name: "Linear",
    url: "https://mcp.linear.app/mcp",
    description: "Linear integration — search and read issues, projects, cycles and documents; create and update issues and comments.",
    writeToolPolicy: { mode: "denylist", tools: [...LINEAR_READ_TOOLS] },
    healthcheckSpec: { name: "__list_tools__", params: {} },
  },
});

export const linearOAuthRouter = router;
export const linearCallbackRouter = callbackRouter;
export const linearOAuthProvider = provider;
export const linearEnsureServer = ensureServer;
