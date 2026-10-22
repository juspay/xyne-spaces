import type { StdioMcpAdapter } from "../types.js";

export const figmaAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "figma",
  healthCheck: { name: "__list_tools__", params: {} },
  forwardFiles: true,
  credentialFields: [
    { name: "apiKey", label: "Figma API Key", type: "password", placeholder: "figd_xxxxxxxxxxxxxxxx" },
  ],
  buildCommand(credentials) {
    const apiKey = credentials["apiKey"] as string;
    return {
      cmd: "npx",
      args: ["-y", "figma-developer-mcp@0.13.2", "--stdio"],
      env: {
        FIGMA_API_KEY: apiKey,
      },
    };
  },
};
