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
  writeTools: ["spaces-create-ticket", "spaces-create-bulk-tickets", "spaces-update-ticket", "spaces-update-bulk-tickets", "spaces-schedule-call", "spaces-start-call", "spaces-create-canvas", "spaces-edit-canvas", "user-send-message", "spaces-upload-to-kb", "spaces-automation-submit", "spaces-automation-webhook-issue"],
  // The everyday read tools, listed up front: synced tools only reach the
  // `tools` table once a user connects, so a fresh environment would otherwise
  // offer only the write tools above and an agent couldn't read activity, DMs
  // or tickets. Automation and admin tools are left to the sync.
  staticTools: [
    "spaces-activity", "spaces-user-activity-context", "spaces-my-items", "spaces-messages",
    "spaces-message-detail", "spaces-channels", "spaces-users", "spaces-whoami", "spaces-search",
    "spaces-search-v2", "spaces-vespa-search", "spaces-tickets", "spaces-projects",
    "spaces-project-team-members", "spaces-boards", "spaces-canvases", "spaces-read-canvas",
    "spaces-calls", "spaces-meeting-insights", "spaces-emails", "spaces-thread-attachments",
    "spaces-fetch-attachment", "spaces-saved-views",
  ],
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
        // Bench lane — set ONLY when the cred lane stamped directVespa + the
        // benchmark Vespa endpoint on this session. Direct-query the bench
        // cluster from THIS child, never through prod's spaces backend.
        ...(credentials["directVespa"] === "true"
          ? {
              DIRECT_VESPA_SEARCH: "true",
              ONYX_BENCH_VESPA: "true",
              ...(typeof credentials["vespaEndpoint"] === "string" && (credentials["vespaEndpoint"] as string).trim()
                ? { VESPA_QUERY_ENDPOINT: String(credentials["vespaEndpoint"]).trim() }
                : {}),
            }
          : {}),
      },
    };
  },
};
