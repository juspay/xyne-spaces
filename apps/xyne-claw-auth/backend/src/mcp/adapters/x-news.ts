import { BUILTIN_SERVER_CMD } from "xyne-claw-mcp-common/protocol";
import type { StdioMcpAdapter } from "../types.js";

// In-tree TS server (no external npx package). Reads public X posts via the
// TwitterAPI.io third-party data API — no X account, no X developer app, just a
// TwitterAPI.io key. Read-only.
export const xNewsAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "x-news",
  healthCheck: { name: "get_user_tweets", params: { username: "OpenAI", count: 1 } },
  writeTools: [],
  staticTools: ["get_user_tweets", "search_tweets"],
  credentialFields: [
    { name: "apiKey", label: "TwitterAPI.io API Key", type: "password", placeholder: "your twitterapi.io key" },
  ],
  buildCommand(credentials) {
    const apiKey = credentials["apiKey"] as string;
    return {
      cmd: BUILTIN_SERVER_CMD,
      args: ["x-news-server"],
      env: {
        TWITTERAPI_IO_KEY: apiKey,
      },
    };
  },
};
