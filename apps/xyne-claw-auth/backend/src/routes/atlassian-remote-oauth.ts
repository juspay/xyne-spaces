import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";
import { ATLASSIAN_READ_TOOLS } from "../mcp/adapters/atlassian-remote.js";

// Atlassian Rovo MCP server v2 (Jira + Confluence), the endpoint Atlassian recommends:
// https://mcp.atlassian.com/v2/mcp. Its authorization server is
// auth.atlassian.com/<id> (see /.well-known/oauth-protected-resource/v2/mcp), which
// supports DCR for public clients and PKCE S256. The legacy v1 flow went through
// mcp.atlassian.com/v1/* and forced a Jira site pick with classic Jira scopes.
// Clients registered against v1 are not valid here, so existing users must reconnect.
const ATLASSIAN_SCOPES = [
  "offline_access",
  "read:me",
  "read:account",
  "email",
  "read:jira:agent-interface",
  "write:jira:agent-interface",
  "search:jira:agent-interface",
  "read:confluence:agent-interface",
  "write:confluence:agent-interface",
  "search:confluence:agent-interface",
  "search:rovo:agent-interface",
].join(" ");

const { router, callbackRouter, provider, ensureServer } = createMcpOAuthProvider({
  type: "atlassian-remote",
  label: "Atlassian",
  registerUrl: "https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3/dcr/register",
  authUrl: "https://auth.atlassian.com/authorize",
  tokenUrl: "https://auth.atlassian.com/oauth/token",
  confidential: false,
  scope: ATLASSIAN_SCOPES,
  resource: "https://mcp.atlassian.com/v2/mcp",
  server: {
    name: "Atlassian (Jira & Confluence)",
    url: "https://mcp.atlassian.com/v2/mcp",
    description: "Atlassian integration — search and read Jira issues and Confluence pages; create and update issues, comments and pages.",
    writeToolPolicy: { mode: "denylist", tools: [...ATLASSIAN_READ_TOOLS] },
    healthcheckSpec: { name: "__list_tools__", params: {} },
  },
});

export const atlassianRemoteOAuthRouter = router;
export const atlassianRemoteCallbackRouter = callbackRouter;
export const atlassianRemoteOAuthProvider = provider;
export const atlassianRemoteEnsureServer = ensureServer;
