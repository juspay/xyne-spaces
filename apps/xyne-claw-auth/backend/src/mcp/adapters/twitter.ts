import { BUILTIN_SERVER_CMD } from "xyne-claw-mcp-common/protocol";
import type { StdioMcpAdapter } from "../types.js";

// Runs as `xyne-mcp-server twitter-server`.
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
      cmd: BUILTIN_SERVER_CMD,
      args: ["twitter-server"],
      env: {
        API_KEY: apiKey,
        API_SECRET_KEY: apiSecretKey,
        ACCESS_TOKEN: accessToken,
        ACCESS_TOKEN_SECRET: accessTokenSecret,
      },
    };
  },
};
