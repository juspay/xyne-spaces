import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";

const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "notion-remote",
  label: "Notion",
  registerUrl: "https://mcp.notion.com/register",
  authUrl: "https://mcp.notion.com/authorize",
  tokenUrl: "https://mcp.notion.com/token",
  confidential: false,
  scope: "default",
  server: {
    name: "Notion",
    url: "https://mcp.notion.com/mcp",
    description:
      "Notion integration — search and fetch pages, query data sources, manage pages, databases, views and comments.",
    writeToolPolicy: {
      mode: "allowlist",
      tools: [
        "notion-create-file-upload",
        "notion-create-attachment",
        "notion-create-pages",
        "notion-update-page",
        "notion-convert-page-to-skill",
        "notion-move-pages",
        "notion-duplicate-page",
        "notion-create-database",
        "notion-create-folder",
        "notion-update-data-source",
        "notion-create-view",
        "notion-update-view",
        "notion-create-comment",
        "notion-spawn-session",
        "notion-send-message-to-session",
        "notion-wait-session",
        "notion-stop-session",
      ],
    },
    healthcheckSpec: { name: "notion-get-teams", params: {} },
  },
});

export const notionRemoteOAuthRouter = router;
export const notionRemoteCallbackRouter = callbackRouter;
export const notionRemoteOAuthProvider = provider;
