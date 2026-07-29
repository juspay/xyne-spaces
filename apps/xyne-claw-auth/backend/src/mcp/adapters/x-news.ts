import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { StdioMcpAdapter } from "../types.js";

// In-tree TS server (no external npx package). Reads public X posts via the
// TwitterAPI.io third-party data API — no X account, no X developer app, just a
// TwitterAPI.io key. Read-only.
const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/x-news-server.ts",
);

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
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        TWITTERAPI_IO_KEY: apiKey,
      },
    };
  },
};
