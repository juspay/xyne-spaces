import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { StdioMcpAdapter } from "../types.js";

// In-tree TS server. The runner spawns this with
//   node --import tsx/esm <SERVER_PATH>
// because the parent backend itself runs under tsx/ESM (see main.ts and
// runner.ts:14 — the runner substitutes the bare 'tsx/esm' specifier with an
// absolute file:// URL because the child is spawned with cwd=/tmp).
const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/linkedin-rapidapi-server.ts",
);

export const rapidApiLinkedInAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "rapidapi-linkedin",
  credentialFields: [
    {
      name: "apiKey",
      label: "X-RapidAPI-Key",
      type: "password",
      placeholder: "your-rapidapi-key",
    },
  ],
  healthCheck: {
    name: "linkedin_get_profile",
    params: { linkedin_url: "https://www.linkedin.com/in/williamhgates" },
  },
  writeTools: [],
  buildCommand(credentials) {
    const apiKey = credentials["apiKey"] as string;
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        RAPIDAPI_KEY: apiKey,
      },
    };
  },
};
