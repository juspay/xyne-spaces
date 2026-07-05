import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { StdioMcpAdapter } from "../types.js";

// In-tree TS server (no external npx package). The runner spawns this with
//   node --import tsx/esm <SERVER_PATH>
// because the parent backend itself runs under tsx/ESM (see runner.ts — it
// substitutes the bare 'tsx/esm' specifier with an absolute file:// URL since
// the child is spawned with cwd=/tmp).
const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/twitter-server.ts",
);

// Twitter / X MCP server. Read-only: exposes `search_tweets`. Auth is OAuth
// 1.0a user context — all four consumer + access keys from the Twitter
// Developer Portal are required.
export const twitterAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "twitter",
  // Cheapest read op for a penny-drop health check. Twitter v2 recent-search
  // requires count >= 10.
  healthCheck: { name: "search_tweets", params: { query: "test", count: 10 } },
  writeTools: [],
  credentialFields: [
    { name: "apiKey", label: "API Key", type: "password", placeholder: "consumer API key" },
    { name: "apiSecretKey", label: "API Secret Key", type: "password", placeholder: "consumer API secret" },
    { name: "accessToken", label: "Access Token", type: "password", placeholder: "user access token" },
    { name: "accessTokenSecret", label: "Access Token Secret", type: "password", placeholder: "user access token secret" },
  ],
  buildCommand(credentials) {
    const apiKey = credentials["apiKey"] as string;
    const apiSecretKey = credentials["apiSecretKey"] as string;
    const accessToken = credentials["accessToken"] as string;
    const accessTokenSecret = credentials["accessTokenSecret"] as string;

    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        API_KEY: apiKey,
        API_SECRET_KEY: apiSecretKey,
        ACCESS_TOKEN: accessToken,
        ACCESS_TOKEN_SECRET: accessTokenSecret,
      },
    };
  },
};
