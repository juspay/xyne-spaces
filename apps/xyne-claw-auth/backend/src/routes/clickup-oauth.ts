import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";

const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "clickup",
  label: "ClickUp",
  registerUrl: "https://mcp.clickup.com/oauth/register",
  authUrl: "https://mcp.clickup.com/oauth/authorize",
  tokenUrl: "https://mcp.clickup.com/oauth/token",
  confidential: false,
  server: {
    name: "ClickUp",
    url: "https://mcp.clickup.com/mcp",
    description:
      "Cloud-based, all-in-one productivity and project management platform — tasks, docs, goals, and chat.",
    writeToolPolicy: {
      // Tool names left empty deliberately — ClickUp's docs
      // (developer.clickup.com/docs/mcp-tools) only publish human-readable
      // titles ("Create Task", "Delete task", ...), not the machine tool
      // identifiers the MCP server actually returns from tools/list. Populate
      // this allowlist from a live tools/list call once connected, mirroring
      // webflow/notion-remote's exact-string allowlists.
      mode: "allowlist",
      tools: [],
    },
    healthcheckSpec: { name: "__list_tools__", params: {} },
  },
});

export const clickupOAuthRouter = router;
export const clickupCallbackRouter = callbackRouter;
export const clickupOAuthProvider = provider;
