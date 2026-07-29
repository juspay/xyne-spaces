import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { getAllCustomTools } from "xyne-claw-shared";
import type { StdioMcpAdapter } from "../types.js";

const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/google-server.ts",
);

// Write tools are derived from the shared defs' `isWriteTool` flag, so the HITL
// approval gate stays in lockstep with the tool implementations — no hand-kept
// allowlist to drift. (Gmail draft/trash, Calendar create/delete, Drive upload/
// share, Sheets/Docs/Slides/Forms mutations, Tasks create/update/delete, …)
const googleWriteTools = getAllCustomTools()
  .filter((t) => t.source === "custom:google" && t.isWriteTool)
  .map((t) => t.slug);

export const googleAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "google",
  // Cheap no-arg read to verify the spawned server + token are live.
  healthCheck: { name: "google-calendar-list", params: {} },
  writeTools: googleWriteTools,
  // No user-entered secret: the OAuth access token is auto-resolved + refreshed
  // by the credential-loader and injected as GOOGLE_ACCESS_TOKEN below.
  credentialFields: [],
  buildCommand(credentials) {
    const token = credentials["accessToken"] as string;
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        GOOGLE_ACCESS_TOKEN: token,
      },
    };
  },
};
