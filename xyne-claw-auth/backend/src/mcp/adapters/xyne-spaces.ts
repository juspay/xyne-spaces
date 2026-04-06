import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { McpAdapter } from "../types.js";

const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/xyne-spaces-server.ts",
);

export const xyneSpacesAdapter: McpAdapter = {
  type: "xyne-spaces",
  pennyDrop: { name: "spaces-channels", params: { limit: 1 } },
  credentialFields: [
    { name: "url", label: "Xyne Spaces URL", type: "text", placeholder: "https://app.spaces.xyne.juspay.net" },
    { name: "token", label: "Google Auth Token", type: "password", placeholder: "Paste your google_access_token" },
  ],
  buildCommand(credentials) {
    const url = (credentials["url"] as string).replace(/\/+$/, "");
    const token = credentials["token"] as string;
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        XYNE_SPACES_URL: url,
        XYNE_SPACES_TOKEN: token,
      },
    };
  },
};
