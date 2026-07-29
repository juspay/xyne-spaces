import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { StdioMcpAdapter } from "../types.js";

const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/query-routing-server.ts",
);

export const queryRoutingAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "query-routing",
  healthCheck: { name: "ping", params: {} },
  writeTools: [],
  credentialFields: [
    { name: "host", label: "Query Routing Host", type: "text", placeholder: "https://example.com" },
    { name: "token", label: "Auth Token (base64)", type: "password", placeholder: "base64-encoded user:pass" },
    { name: "agent", label: "Agent", type: "text", placeholder: "investigation", optional: true },
    { name: "source", label: "Source", type: "text", placeholder: "xyne_spaces", optional: true },
  ],
  buildCommand(credentials) {
    const host = (credentials["host"] as string).replace(/\/+$/, "");
    const token = credentials["token"] as string;
    const agent = (credentials["agent"] as string | undefined) ?? "investigation";
    const source = (credentials["source"] as string | undefined) ?? "xyne_spaces";
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        QUERY_ROUTING_HOST: host,
        QUERY_ROUTING_TOKEN: token,
        QUERY_ROUTING_AGENT: agent,
        QUERY_ROUTING_SOURCE: source,
      },
    };
  },
};
