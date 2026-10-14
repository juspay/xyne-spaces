import type { HttpMcpAdapter } from "../types.js";

/**
 * Read-only tools of Slack's MCP server. Anything not listed is treated as a
 * write and needs approval; see LINEAR_READ_TOOLS for the reasoning. Verify
 * against a live tools/list when connected.
 */
export const SLACK_READ_TOOLS = [
  "slack_search_public",
  "slack_search_public_and_private",
  "slack_search_channels",
  "slack_search_users",
  "slack_read_channel",
  "slack_read_thread",
  "slack_read_canvas",
  "slack_read_user_profile",
] as const;

/**
 * Slack MCP — Streamable HTTP at https://mcp.slack.com/mcp. Auth: a Slack user
 * token (xoxp-) as Bearer, from routes/slack-remote-oauth.ts as { accessToken,
 * refreshToken, expires }. The stdio `slack` connector (bot token) is unaffected.
 */
export const slackRemoteAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "slack-remote",
  credentialFields: [],
  healthCheck: { name: "__list_tools__", params: {} },
  writePolicy: { mode: "denylist", tools: SLACK_READ_TOOLS },
  buildHttpUrl(credentials) {
    return {
      url: "https://mcp.slack.com/mcp",
      headers: { Authorization: `Bearer ${String(credentials["accessToken"] ?? "")}` },
    };
  },
};
