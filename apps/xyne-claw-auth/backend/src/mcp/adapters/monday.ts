import type { StdioMcpAdapter } from "../types.js";

export const mondayAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "monday",
  healthCheck: { name: "__list_tools__", params: {} },
  credentialFields: [
    { name: "apiKey", label: "monday.com API Token", type: "password", placeholder: "Developers → My access tokens" },
  ],
  writeTools: [],
  buildCommand(credentials) {
    return {
      cmd: "npx",
      args: [
        "-y",
        "@mondaydotcomorg/monday-api-mcp@3.3.1",
        "-t",
        credentials["apiKey"] as string,
        "--enable-dynamic-api-tools",
        "true",
      ],
      env: {},
    };
  },
};
