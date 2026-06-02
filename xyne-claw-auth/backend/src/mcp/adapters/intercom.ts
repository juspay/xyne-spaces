import type { StdioMcpAdapter } from "../types.js";

export const intercomAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "intercom",
  healthCheck: { name: "ic_list_conversations", params: {} },
  writeTools: [],
  credentialFields: [
    { name: "accessToken", label: "Intercom Access Token", type: "password", placeholder: "your-intercom-access-token" },
  ],
  buildCommand(credentials) {
    const accessToken = credentials["accessToken"] as string;

    return {
      cmd: "npx",
      args: [
        "-y", "mcp-remote",
        "https://mcp.intercom.com/mcp",
        "--header",
        `Authorization:Bearer ${accessToken}`,
      ],
      env: {},
    };
  },
};