import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CONFIG } from "../../config.js";
import type { StdioMcpAdapter } from "../types.js";
import { HEISENBERG_TOOL_NAMES } from "../servers/heisenberg-tools.js";

const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/heisenberg-server.ts",
);

/**
 * Global credentialless proxy for the internal Heisenberg pipeline REST API.
 * The base URL is fixed by deployment config; users never supply arbitrary
 * destinations or credentials.
 */
export const heisenbergAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "heisenberg",
  credentialFields: [],
  healthCheck: { name: "heisenberg_health", params: {} },
  writeTools: ["heisenberg_start_pipeline", "heisenberg_index_logs"],
  staticTools: HEISENBERG_TOOL_NAMES,
  buildCommand(credentials) {
    const baseUrl = String(credentials["baseUrl"] ?? CONFIG.heisenbergBaseUrl).replace(/\/+$/, "");
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        HEISENBERG_BASE_URL: baseUrl,
      },
    };
  },
};
