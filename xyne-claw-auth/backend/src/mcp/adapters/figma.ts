import type { StdioMcpAdapter } from "../types.js";

export const figmaAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "figma",
  healthCheck: { name: "get_figma_file", params: { fileKey: "test" } },
  credentialFields: [
    { name: "apiKey", label: "Figma API Key", type: "password", placeholder: "figd_xxxxxxxxxxxxxxxx" },
  ],
  buildCommand(credentials) {
    const apiKey = credentials["apiKey"] as string;
    return {
      cmd: "npx",
      args: ["-y", "figma-mcp@0.1.4"],
      env: {
        FIGMA_API_KEY: apiKey,
      },
    };
  },
};
