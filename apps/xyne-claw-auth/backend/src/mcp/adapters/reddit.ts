import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { StdioMcpAdapter } from "../types.js";

// In-tree TS server (no external npx package). The runner spawns this with
//   node --import tsx/esm <SERVER_PATH>
// because the parent backend itself runs under tsx/ESM.
const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/reddit-server.ts",
);

// Reddit MCP server — read-only, UNAUTHENTICATED (public .json endpoints).
// No Reddit account / app / client id required. Exposes search_reddit and
// get_subreddit_posts only. Note: Reddit throttles anonymous requests from
// server IPs (429/403); for reliable access switch to an approved OAuth app.
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
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        ...(userAgent ? { REDDIT_USER_AGENT: userAgent } : {}),
      },
    };
  },
};
