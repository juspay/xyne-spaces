import { BUILTIN_SERVER_CMD } from "xyne-claw-mcp-common/protocol";
import type { StdioMcpAdapter } from "../types.js";

// Runs as `xyne-mcp-server linkedin-rapidapi-server`.
export const rapidApiLinkedInAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "rapidapi-linkedin",
  credentialFields: [
    {
      name: "apiKey",
      label: "X-RapidAPI-Key",
      type: "password",
      placeholder: "your-rapidapi-key",
    },
  ],
  healthCheck: {
    name: "linkedin_get_profile",
    params: { linkedin_url: "https://www.linkedin.com/in/williamhgates" },
  },
  writeTools: [],
  buildCommand(credentials) {
    const apiKey = credentials["apiKey"] as string;
    return {
      cmd: BUILTIN_SERVER_CMD,
      args: ["linkedin-rapidapi-server"],
      env: {
        RAPIDAPI_KEY: apiKey,
      },
    };
  },
};
