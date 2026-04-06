import type { McpAdapter } from "../types.js";

export const bitbucketAdapter: McpAdapter = {
  type: "bitbucket",
  pennyDrop: { name: "list_projects", params: { limit: 1, start: 0 } },
  credentialFields: [
    { name: "username", label: "Bitbucket Username", type: "text", placeholder: "your-username" },
    { name: "token", label: "Bitbucket Token", type: "password", placeholder: "Enter your Bitbucket access token" },
    { name: "baseUrl", label: "Bitbucket Base URL", type: "text", placeholder: "https://bitbucket.example.com", optional: true },
  ],
  buildCommand(credentials) {
    const username = credentials["username"] as string;
    const token = credentials["token"] as string;
    const baseUrl = (credentials["baseUrl"] as string) || "https://bitbucket.example.com";
    return {
      cmd: "npx",
      args: ["-y", "@nexus2520/bitbucket-mcp-server"],
      env: {
        BITBUCKET_USERNAME: username,
        BITBUCKET_TOKEN: token,
        BITBUCKET_BASE_URL: baseUrl,
      },
    };
  },
};
