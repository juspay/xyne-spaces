import type { StdioMcpAdapter } from "../types.js";

export const asanaAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "asana",
  healthCheck: { name: "asana_list_workspaces", params: {} },
  writeTools: [
    "asana_create_task", "asana_update_task", "asana_delete_task",
    "asana_create_project", "asana_update_project", "asana_delete_project",
    "asana_add_task_to_project", "asana_remove_task_from_project",
    "asana_create_section", "asana_update_section", "asana_delete_section",
    "asana_add_task_comment",
  ],
  credentialFields: [
    { name: "accessToken", label: "Asana Personal Access Token", type: "password", placeholder: "1/1234567890:abcdef..." },
  ],
  buildCommand(credentials) {
    const accessToken = credentials["accessToken"] as string;

    return {
      cmd: "npx",
      args: ["-y", "@roychri/mcp-server-asana"],
      env: {
        ASANA_ACCESS_TOKEN: accessToken,
      },
    };
  },
};