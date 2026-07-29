import type { StdioMcpAdapter } from "../types.js";

/**
 * Notion MCP — official `@notionhq/notion-mcp-server`. The legacy self-serve
 * `notion` connector was misconfigured (launch args were just `["-y"]` with no
 * package and an empty credential form), so it never worked and there are no
 * usable stored creds to preserve — existing users of that type must reconnect
 * to supply a Notion integration token.
 */
export const notionAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "notion",
  healthCheck: { name: "API-get-self", params: {} },
  writeTools: [
    "API-patch-page", "API-post-page", "API-create-a-comment",
    "API-update-a-block", "API-delete-a-block", "API-patch-block-children",
    "API-create-a-database", "API-update-a-database",
  ],
  credentialFields: [
    { name: "token", label: "Notion Integration Token", type: "password", placeholder: "ntn_..." },
  ],
  buildCommand(credentials) {
    const token = String(credentials["token"] ?? "");
    return {
      cmd: "npx",
      args: ["-y", "@notionhq/notion-mcp-server@2.2.1"],
      env: {
        OPENAPI_MCP_HEADERS: JSON.stringify({
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
        }),
      },
    };
  },
};
