import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { getAllCustomTools } from "xyne-claw-shared";
import type { StdioMcpAdapter } from "../types.js";

const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/microsoft-server.ts",
);

// Write tools derived from the shared defs' `isWriteTool` flag (Outlook draft/
// trash, Calendar create/delete, Tasks create/update/delete, Teams send, …).
const microsoftWriteTools = getAllCustomTools()
  .filter((t) => t.source === "custom:microsoft" && t.isWriteTool)
  .map((t) => t.slug);

export const microsoftAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "microsoft",
  healthCheck: { name: "microsoft-calendar-list", params: {} },
  writeTools: microsoftWriteTools,
  // No user-entered secret: the OAuth access token is auto-resolved + refreshed
  // by the credential-loader and injected as MICROSOFT_ACCESS_TOKEN below.
  credentialFields: [],
  buildCommand(credentials) {
    const token = credentials["accessToken"] as string;
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        MICROSOFT_ACCESS_TOKEN: token,
      },
    };
  },
};
