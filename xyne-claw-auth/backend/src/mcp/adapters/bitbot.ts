import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { CONFIG } from "../../config.js";
import type { StdioMcpAdapter } from "../types.js";

const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/bitbot-server.ts",
);

export const bitbotAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "bitbot",
  healthCheck: { name: "ping", params: {} },
  writeTools: [],
  credentialFields: [],
  buildCommand(_credentials) {
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        // Source-of-truth is CONFIG.bitbotBaseUrl (config.ts). Forward it to
        // the spawned process env every time — even when the env var wasn't
        // set on the parent — so the server doesn't have to know the default.
        // Access is NAT-IP gated on pr-analysis's side; no token to pipe.
        BITBOT_BASE_URL: CONFIG.bitbotBaseUrl,
      },
    };
  },
};
