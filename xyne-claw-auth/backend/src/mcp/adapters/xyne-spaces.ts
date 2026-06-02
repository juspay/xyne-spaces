import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { StdioMcpAdapter } from "../types.js";

const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/xyne-spaces-server.ts",
);

export const xyneSpacesAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "xyne-spaces",
  healthCheck: { name: "spaces-channels", params: { limit: 1 } },
  writeTools: ["spaces-create-ticket", "spaces-update-ticket", "spaces-schedule-call", "spaces-memory-create", "spaces-create-canvas", "spaces-edit-canvas"],
  credentialFields: [
    { name: "url", label: "Xyne Spaces URL", type: "text", placeholder: "https://app.spaces.xyne.juspay.net" },
    { name: "token", label: "Google Auth Token", type: "password", placeholder: "Paste your google_access_token" },
  ],
  buildCommand(credentials) {
    const url = (credentials["url"] as string).replace(/\/+$/, "");
    const token = credentials["token"] as string;
    const sessionId = (credentials["sessionId"] as string | undefined) ?? "";
    const workspaceId = (credentials["workspaceId"] as string | undefined) ?? "";
    const userId = (credentials["userId"] as string | undefined) ?? "";
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        XYNE_SPACES_URL: url,
        XYNE_SPACES_TOKEN: token,
        XYNE_SPACES_SESSION_ID: sessionId,
        XYNE_SPACES_WORKSPACE_ID: workspaceId,
        INTERNAL_S2S_KEY: process.env["INTERNAL_S2S_KEY"] ?? "",
        XYNE_USER_ID: userId,
      },
    };
  },
};
