import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { StdioMcpAdapter } from "../types.js";

const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/xyne-dashboard-server.ts",
);

/**
 * Dedicated MCP server for the dashboard-ai agent's dynamic-dashboard tools.
 * Separate from xyne-spaces ON PURPOSE: the tools are pinned to dashboard-ai
 * via its AgentMcpConnection row, so they never leak into other agents'
 * palettes (or the spaces subagent). Credentials are synthesized from the
 * user's live Spaces session — see the xyne-dashboard branch in
 * lib/credentials-loader.ts and mcp/runner.ts.
 */
export const xyneDashboardAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "xyne-dashboard",
  // suggest_components is handled locally in the server (no Spaces round-trip),
  // so the penny-drop works without a real data source in scope.
  healthCheck: {
    name: "suggest_components",
    params: { message: "health check", suggestions: [{ label: "ok", prompt: "ok" }] },
  },
  // Dashboard edits are autonomous by design — the user watches tiles appear
  // live in the editor and every plan is server-validated before persisting.
  writeTools: [],
  credentialFields: [
    { name: "url", label: "Xyne Spaces URL", type: "text", placeholder: "https://app.spaces.xyne.juspay.net" },
    { name: "token", label: "Session token", type: "password", placeholder: "" },
  ],
  buildCommand(credentials) {
    const url = String(credentials["url"] ?? "").replace(/\/+$/, "");
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
