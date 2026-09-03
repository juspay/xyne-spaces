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
  // Tools listed here are gated by the HITL (write-action) approval flow —
  // the agent emits a Approve/Decline card in the thread and the user must
  // click Approve before the tool executes. user-send-message posts a
  // message AS THE USER, so it must require explicit consent before sending.
  // apps-send-message (in the sibling xyne-spaces-app-tools MCP) is NOT
  // gated by design — that one acts as the bot identity, autonomously.
  // spaces-edit-canvas is NOT gated: edits to existing canvases only park
  // suggestions the human reviews in the canvas, so that review is the gate.
  writeTools: ["spaces-create-ticket", "spaces-create-bulk-tickets", "spaces-update-ticket", "spaces-schedule-call", "spaces-create-canvas", "user-send-message", "spaces-upload-to-kb"],
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
    // "app" when the run is an agent's app user (no login session): `token` is
    // the agent's app token and the server routes tools to the /api/apps/*
    // routes. Defaults to "user" (session token → /api/query). Set by the
    // runner's app-user fallback.
    const authMode = (credentials["authMode"] as string | undefined) === "app" ? "app" : "user";
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        XYNE_SPACES_URL: url,
        XYNE_SPACES_TOKEN: token,
        XYNE_SPACES_SESSION_ID: sessionId,
        XYNE_SPACES_WORKSPACE_ID: workspaceId,
        XYNE_SPACES_AUTH_MODE: authMode,
        INTERNAL_S2S_KEY: process.env["INTERNAL_S2S_KEY"] ?? "",
        XYNE_USER_ID: userId,
      },
    };
  },
};
