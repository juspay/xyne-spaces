import type { StdioMcpAdapter } from "../types.js";

/**
 * Excalidraw MCP — local drawing/diagram server (`@scofieldfree/excalidraw-mcp`).
 * No credentials. Replaces the legacy self-serve `excalidraw` connector after the
 * stdio-launchConfig lockdown; the launch command is identical so existing
 * connections keep working with no reconnect.
 */
export const excalidrawAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "excalidraw",
  // best-effort penny-drop; verify against the running server's tool list
  healthCheck: { name: "get_scene", params: {} },
  credentialFields: [],
  buildCommand() {
    return { cmd: "npx", args: ["-y", "@scofieldfree/excalidraw-mcp@0.1.1"], env: {} };
  },
};
