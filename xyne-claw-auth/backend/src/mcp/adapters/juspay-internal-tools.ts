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
 * Tool filtering: x-tools-needed header requests only the "curie" category,
 * so juspay returns only Curie CRM tools (7 tools for lead/org/ticket queries).
 */
export const juspayInternalToolsAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "juspay-internal-tools",
  // __list_tools__ performs a real listTools() call against the Python server,
  // verifying connectivity and returning the live tool count.
  healthCheck: { name: "__list_tools__", params: {} },
  writeTools: [],
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
