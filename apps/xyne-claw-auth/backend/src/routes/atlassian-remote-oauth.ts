import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";
import { atlassianRemoteAdapter } from "../mcp/adapters/atlassian-remote.js";

// No `scope`: Atlassian's MCP auth server advertises none; the user grants
// access per product on Atlassian's consent screen.
const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "atlassian-remote",
  label: "Jira",
  registerUrl: "https://mcp.atlassian.com/v1/register",
  authUrl: "https://mcp.atlassian.com/v1/authorize",
  tokenUrl: "https://mcp.atlassian.com/v1/token",
  confidential: false,
  server: {
    name: "Jira",
    url: "https://mcp.atlassian.com/v1/mcp",
    description: "Jira & Confluence (Atlassian) — search with JQL, read, create, edit and transition issues, and work with Confluence pages.",
    writeToolPolicy: { mode: "allowlist", tools: atlassianRemoteAdapter.writeTools },
    healthcheckSpec: atlassianRemoteAdapter.healthCheck,
  },
});

export const atlassianRemoteOAuthRouter = router;
export const atlassianRemoteCallbackRouter = callbackRouter;
export const atlassianRemoteOAuthProvider = provider;
