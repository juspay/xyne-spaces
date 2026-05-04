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
  credentialFields: [
    { name: "token", label: "Xyne Space Token", type: "password", placeholder: "******************" },
    { name: "juspay_token", label: "Juspay Token", type: "password", placeholder: "*****************" },
    { name: "pomerium_cookie", label: "Pomerium Cookie (_pomerium value)", type: "password", placeholder: "eyJhbGciOi..." },
  ],
  buildCommand(credentials) {
    const token = credentials["token"] as string;
    const juspayToken = credentials["juspay_token"] as string;
    const pomeriumCookie = (credentials["pomerium_cookie"] as string) ?? "";
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        XYNE_SPACE_TOKEN: token,
        JUSPAY_TOKEN: juspayToken,
        JUSPAY_POMERIUM_COOKIE: pomeriumCookie,
      },
    };
  },
};
