import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { SDLC_MCP_SERVER_TYPE, SDLC_TOOL_NAMES } from "xyne-claw-shared";
import type { StdioMcpAdapter } from "../types.js";

const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/xyne-spaces-sdlc-server.ts",
);

export function sdlcSpacesUrl(credentialUrl: unknown): string {
  return String(process.env["SPACES_SDLC_URL"]?.trim() || credentialUrl || "").replace(/\/+$/, "");
}

export const xyneSpacesSdlcAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: SDLC_MCP_SERVER_TYPE,
  healthCheck: { name: SDLC_TOOL_NAMES.listArtifactTypes, params: {} },
  writeTools: [],
  credentialFields: [],
  buildCommand(credentials) {
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        XYNE_SPACES_URL: sdlcSpacesUrl(credentials["url"]),
        XYNE_SPACES_TOKEN: String(credentials["token"] ?? ""),
        XYNE_SPACES_SESSION_ID: String(credentials["sessionId"] ?? ""),
        XYNE_SPACES_WORKSPACE_ID: String(credentials["workspaceId"] ?? ""),
        XYNE_SPACES_AUTH_MODE: credentials["authMode"] === "app" ? "app" : "user",
        INTERNAL_S2S_KEY: process.env["INTERNAL_S2S_KEY"] ?? "",
        XYNE_USER_ID: String(credentials["userId"] ?? ""),
      },
    };
  },
};
