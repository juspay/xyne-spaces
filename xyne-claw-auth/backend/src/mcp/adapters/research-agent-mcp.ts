import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { CONFIG } from "../../config.js";
import type { StdioMcpAdapter } from "../types.js";

const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/research-agent-mcp-server.ts",
);

export const researchAgentMcpAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "research-agent-mcp",
  healthCheck: { name: "ping", params: {} },
  writeTools: [],
  credentialFields: [],
  buildCommand(credentials) {
    const apiKey =
      (credentials["apiKey"] as string | undefined) ??
      CONFIG.researchAgentMcpApiKey;
    const serverUrl =
      (credentials["serverUrl"] as string | undefined) ??
      CONFIG.researchAgentBaseUrl;

    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        RESEARCH_AGENT_MCP_API_KEY: apiKey,
        RESEARCH_AGENT_MCP_SERVER_URL: serverUrl,
      },
    };
  },
};
