import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { StdioMcpAdapter } from "../types.js";
import { WORKFLOW_WRITE_TOOL_NAMES } from "../servers/xyne-workflows-tools.js";

const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/xyne-workflows-server.ts",
);

export const xyneWorkflowsAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "xyne-workflows",
  healthCheck: { name: "workflow_catalog", params: {} },
  writeTools: [...WORKFLOW_WRITE_TOOL_NAMES],
  credentialFields: [],
  buildCommand(credentials) {
    const url = String(
      process.env["WORKFLOWS_SPACES_URL"] || credentials["url"] || "",
    ).replace(/\/+$/, "");
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        XYNE_SPACES_URL: url,
        XYNE_SPACES_TOKEN: String(credentials["token"] ?? ""),
        XYNE_SPACES_SESSION_ID: String(credentials["sessionId"] ?? ""),
        XYNE_SPACES_WORKSPACE_ID: String(credentials["workspaceId"] ?? ""),
        INTERNAL_S2S_KEY: process.env["INTERNAL_S2S_KEY"] ?? "",
        XYNE_USER_ID: String(credentials["userId"] ?? ""),
      },
    };
  },
};
