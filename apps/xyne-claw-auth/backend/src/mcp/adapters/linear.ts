import type { HttpMcpAdapter } from "../types.js";

/**
 * Read-only tools of Linear's hosted MCP server. Every other tool the server
 * exposes (including ones added later) is treated as a write and needs user
 * approval — an incomplete list here errs toward asking, never toward silently
 * allowing a write. Verify against a live tools/list when connected.
 */
export const LINEAR_READ_TOOLS = [
  "list_comments",
  "list_cycles",
  "get_document",
  "list_documents",
  "get_issue",
  "list_issues",
  "list_issue_statuses",
  "get_issue_status",
  "list_issue_labels",
  "list_projects",
  "get_project",
  "list_project_labels",
  "list_teams",
  "get_team",
  "list_users",
  "get_user",
  "search_documentation",
  "get_attachment",
  "extract_images",
] as const;

/**
 * Linear hosted MCP — Streamable HTTP at https://mcp.linear.app/mcp.
 * Auth: OAuth 2.1 with DCR + PKCE (public client). Stored credentials come from
 * routes/linear-oauth.ts as { clientId, accessToken, refreshToken, expires }.
 * Linear also accepts an API key as a Bearer token, but this connector is
 * OAuth-only so the token refreshes.
 */
export const linearAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "linear",
  credentialFields: [],
  healthCheck: { name: "__list_tools__", params: {} },
  writePolicy: { mode: "denylist", tools: LINEAR_READ_TOOLS },
  buildHttpUrl(credentials) {
    return {
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: `Bearer ${String(credentials["accessToken"] ?? "")}` },
    };
  },
};
