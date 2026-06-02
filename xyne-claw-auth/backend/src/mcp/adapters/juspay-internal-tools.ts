import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { StdioMcpAdapter } from "../types.js";

const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/juspay-internal-tools-server.ts",
);

export const juspayInternalToolsAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "juspay-internal-tools",
  healthCheck: { name: "ping", params: {} },
  writeTools: [],
  credentialFields: [],
  buildCommand(_credentials) {
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        JUSPAY_INTERNAL_TOOLS_VALIDATE_TOKEN: process.env["JUSPAY_INTERNAL_TOOLS_VALIDATE_TOKEN"] ?? "",
        ...(process.env["JUSPAY_INTERNAL_TOOLS_BASE_URL"]
          ? { JUSPAY_INTERNAL_TOOLS_BASE_URL: process.env["JUSPAY_INTERNAL_TOOLS_BASE_URL"] }
          : {}),
      },
    };
  },
};
