import type { StdioMcpAdapter } from "../types.js";

export const githubAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "github",
  healthCheck: { name: "search_repositories", params: { query: "test" } },
  writeTools: [
    "create_repository",
    "fork_repository",
    "push_files",
    "create_or_update_file",
    "create_branch",
    "create_issue",
    "update_issue",
    "add_issue_comment",
    "create_pull_request",
    "merge_pull_request",
    "update_pull_request_branch",
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
