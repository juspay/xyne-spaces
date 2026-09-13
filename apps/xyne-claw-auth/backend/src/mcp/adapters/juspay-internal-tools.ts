import type { HttpMcpAdapter } from "../types.js";

const TOKEN = process.env["JUSPAY_INTERNAL_TOOLS_VALIDATE_TOKEN"] ?? "";
const BASE_URL =
  process.env["JUSPAY_INTERNAL_TOOLS_BASE_URL"] ??
  "http://juspay-internal-tools-ext.internal.svc.k8s.dozer.mum.juspay.net/";

/**
 * Connects directly to the juspay-internal-tools Python MCP server's /tools
 * HTTP endpoint via Streamable HTTP transport. Tools are fetched dynamically
 * from the real server — no hardcoded tool list.
 *
 * Authentication: x-api-key header carries the shared s2s token
 * (JUSPAY_INTERNAL_TOOLS_VALIDATE_TOKEN), which must match SERVER_API_KEY
 * configured on juspay-internal-tools.
 *
 * Tool filtering: the x-tools-needed header selects which categories juspay
 * returns -- "curie" (Curie CRM: 7 read tools plus 2 write tools for
 * lead/org/ticket queries and ticket edits), "default" and "admin_config".
 *
 * writeTools gates the two Curie write tools behind the human approval flow:
 * routes/mcp.ts forces permission to "ask" for any tool named here (it cannot
 * be overridden by agent config) and refuses to sign an action for a tool that
 * is not. Names must be the RAW MCP tool names, not the prefixed runtime ones.
 */
export const juspayInternalToolsAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "juspay-internal-tools",
  // __list_tools__ performs a real listTools() call against the Python server,
  // verifying connectivity and returning the live tool count.
  healthCheck: { name: "__list_tools__", params: {} },
  writeTools: ["curie_ticket_patch", "curie_ticket_comment_create"],
  credentialFields: [],
  buildHttpUrl(_credentials) {
    return {
      url: `${BASE_URL.replace(/\/$/, "")}/tools`,
      headers: {
        "x-api-key": TOKEN,
        "x-tools-needed": JSON.stringify(["curie","default", "admin_config"]),
      },
    };
  },
};
