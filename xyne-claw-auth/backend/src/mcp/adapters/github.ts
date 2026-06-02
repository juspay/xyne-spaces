import type { StdioMcpAdapter } from "../types.js";

export const githubAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "github",
  healthCheck: { name: "search_repositories", params: { query: "test" } },
  writeTools: [
    "create_repository",
    "merge_pull_request",
  ],
  credentialFields: [
    { name: "token", label: "GitHub Personal Access Token", type: "password", placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx" },
  ],
  buildCommand(credentials) {
    const token = credentials["token"] as string;

    return {
      cmd: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_TOKEN: token,
        GITHUB_PERSONAL_ACCESS_TOKEN: token,
      },
    };
  },
};
