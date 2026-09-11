import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { StdioMcpAdapter } from "../types.js";

const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/xyne-spaces-app-tools-server.ts",
);

/**
 * Adapter for the Xyne Spaces App Tools MCP server.
 *
 * Uses the agent's app token (bot credentials) injected via credential field "app_token".
 * Auto-connected for every user via autoConfigureSpaces in users.ts — the app token is
 * sourced from the default agent's spacesAppToken and stored per-user at connect time.
 *
 * No user approval needed — the bot acts autonomously.
 */
export const xyneSpacesAppToolsAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "xyne-spaces-app-tools",
  healthCheck: { name: "ping", params: {} },
  writeTools: [],
  // Surfaces the bot tool in the agent-config picker without requiring a
  // per-user tool-sync. See routes/tools.ts:185-196 — the picker unions
  // adapter writeTools + staticTools. NOT a HITL gate; this tool stays
  // autonomous (the whole point of the app-tools server).
  staticTools: ["apps-send-message"],
  credentialFields: [],
  buildCommand(credentials) {
    const appToken = (credentials["app_token"] as string | undefined) ?? "";
    const spacesUrl = (credentials["url"] as string | undefined) ?? "";
    const workspaceId = (credentials["workspaceId"] as string | undefined) ?? "";
    const userId = (credentials["userId"] as string | undefined) ?? "";
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        XYNE_SPACES_APP_TOKEN: appToken,
        XYNE_SPACES_URL: spacesUrl,
        XYNE_SPACES_WORKSPACE_ID: workspaceId,
        // The app-tools server now also mounts the shared Spaces tool registry
        // (see xyne-spaces-app-tools-server.ts). Those tools read XYNE_SPACES_TOKEN
        // + XYNE_SPACES_AUTH_MODE via the shared client, so mirror the app token
        // into XYNE_SPACES_TOKEN and pin app mode. This server ALWAYS acts as the
        // bot, so the mode is unconditionally "app".
        XYNE_SPACES_TOKEN: appToken,
        XYNE_SPACES_AUTH_MODE: "app",
        XYNE_USER_ID: userId,
        INTERNAL_S2S_KEY: process.env["INTERNAL_S2S_KEY"] ?? "",
      },
    };
  },
};
