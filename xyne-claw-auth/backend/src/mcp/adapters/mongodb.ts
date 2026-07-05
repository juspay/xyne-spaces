import type { StdioMcpAdapter } from "../types.js";

/**
 * MongoDB MCP — official `mongodb-mcp-server`, launched read-only (`--readOnly`)
 * so write tools are disabled at the server. Replaces the legacy self-serve
 * `mongodb` connector after the stdio-launchConfig lockdown; the `connectionString`
 * credential and launch args match what those connections already stored, so
 * existing creds keep working with no reconnect.
 */
export const mongodbAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "mongodb",
  healthCheck: { name: "list-databases", params: {} },
  // Approval-gated even though `--readOnly` already blocks them server-side —
  // belt-and-suspenders in case the flag is ever dropped.
  writeTools: [
    "insert-one", "insert-many", "update-one", "update-many",
    "delete-one", "delete-many", "drop-collection", "drop-database",
    "create-collection", "create-index", "rename-collection",
  ],
  credentialFields: [
    { name: "connectionString", label: "MongoDB Connection String", type: "password", placeholder: "mongodb+srv://user:pass@cluster/db" },
  ],
  buildCommand(credentials) {
    const connectionString = String(credentials["connectionString"] ?? "");
    return {
      cmd: "npx",
      args: ["-y", "mongodb-mcp-server@1.12.0", "--connectionString", connectionString, "--readOnly"],
      env: {},
    };
  },
};
