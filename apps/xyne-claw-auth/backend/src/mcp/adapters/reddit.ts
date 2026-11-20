import { BUILTIN_SERVER_CMD } from "xyne-claw-mcp-common/protocol";
import type { StdioMcpAdapter } from "../types.js";

// Runs as `xyne-mcp-server reddit-server`.
export const redditAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "reddit",
  healthCheck: { name: "get_subreddit_posts", params: { subreddit: "announcements", limit: 1 } },
  writeTools: [],
  // Selectable in the agent tool picker before any connection/sync.
  staticTools: ["search_reddit", "get_subreddit_posts"],
  // No credentials required. A descriptive User-Agent is optional but polite.
  credentialFields: [
    { name: "userAgent", label: "User-Agent (optional)", type: "text", placeholder: "myapp/1.0 by u/you", optional: true },
  ],
  buildCommand(credentials) {
    const userAgent = (credentials["userAgent"] as string | undefined) ?? "";
    return {
      cmd: BUILTIN_SERVER_CMD,
      args: ["reddit-server"],
      env: {
        ...(userAgent ? { REDDIT_USER_AGENT: userAgent } : {}),
      },
    };
  },
};
