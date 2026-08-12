import type { HttpMcpAdapter } from "../types.js";

/**
 * Jusbiz Expense MCP adapter (remote streamable-HTTP MCP).
 *
 * Hosted HTTP MCP endpoint:
 *   Set JUSBIZ_MCP_URL to the remote streamable-HTTP endpoint.
 *
 * Auth: static HTTP Basic. The connection stores the base64 credential
 * (the part after "Basic ") as `authToken`; we send it as the Authorization
 * header. This mirrors the raw client config:
 *
 *   "headers": { "Authorization": "Basic <base64>" }
 *
 * The token is entered as a connection credential (NOT committed to the repo).
 * If this should instead be a shared/always-on connector, drop credentialFields
 * and read the token from config/env in buildHttpUrl.
 */
export const jusbizMcpAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "jusbiz-mcp",
  credentialFields: [
    {
      name: "authToken",
      label: "Basic auth token (base64)",
      type: "password",
      placeholder: "the value after 'Basic ' — e.g. Sk43V09SQkpOQUJNOVBWRg==",
    },
  ],
  // Verify the connection by listing tools rather than calling a specific tool —
  // we don't hardcode jusbiz tool names here, so health = "connected + at least
  // one tool exposed" (see the __list_tools__ branch in health.ts).
  healthCheck: { name: "__list_tools__", params: {} },
  // TODO: once the jusbiz tools/list is known, list any mutating tool names here
  // so they require user approval (write-action gating).
  writeTools: [],
  buildHttpUrl(credentials) {
    const authToken = credentials["authToken"];
    if (typeof authToken !== "string" || authToken.length === 0) {
      throw new Error("jusbiz-mcp credentials missing authToken (base64 Basic value)");
    }
    const url = process.env["JUSBIZ_MCP_URL"] ?? "";
    if (!url) {
      throw new Error("JUSBIZ_MCP_URL is required for jusbiz-mcp");
    }
    return {
      url,
      headers: {
        Authorization: `Basic ${authToken}`,
      },
    };
  },
};
