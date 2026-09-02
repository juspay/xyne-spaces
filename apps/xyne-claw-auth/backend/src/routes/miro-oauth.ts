import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";

const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "miro",
  label: "Miro",
  registerUrl: "https://mcp.miro.com/register",
  authUrl: "https://mcp.miro.com/authorize",
  tokenUrl: "https://mcp.miro.com/token",
  confidential: true,
  scope: "boards:read boards:write",
  server: {
    name: "Miro",
    url: "https://mcp.miro.com/",
    description: "Miro integration — generate diagrams, read board context, create documents, tables, and code widgets.",
    writeToolPolicy: {
      mode: "allowlist",
      tools: [
        "diagram_create",
        "doc_create",
        "doc_update",
        "table_create",
        "table_sync_rows",
        "board_create",
        "image_create",
        "image_get_upload_url",
        "code_widget_create",
        "code_widget_delete",
        "code_widget_update",
        "comment_reply",
        "comment_resolve",
        "layout_create",
        "layout_update",
      ],
    },
    healthcheckSpec: { name: "board_search_boards", params: {} },
  },
});

export const miroOAuthRouter = router;
export const miroCallbackRouter = callbackRouter;
export const miroOAuthProvider = provider;
