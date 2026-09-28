import type { StdioMcpAdapter } from "../types.js";

// Mirrors the live prod DB row's launchConfigTemplate. Official monday.com
// package (@mondaydotcomorg npm org), npx-based so it's covered by
// provisionStdioCommand()'s hardened install/prewarm path.
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
        "@mondaydotcomorg/monday-api-mcp",
        "-t",
        credentials["apiKey"] as string,
        "--enable-dynamic-api-tools",
        "true",
      ],
      env: {},
    };
  },
};
