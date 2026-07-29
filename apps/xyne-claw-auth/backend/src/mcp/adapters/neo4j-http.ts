import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { StdioMcpAdapter } from "../types.js";

// In-tree TS server. The runner spawns this with
//   node --import tsx/esm <SERVER_PATH>
// because the parent backend itself runs under tsx/ESM (see main.ts and
// runner.ts — the runner substitutes the bare 'tsx/esm' specifier with an
// absolute file:// URL because the child is spawned with cwd=/tmp). SERVER_PATH
// is resolved to an absolute path here so it survives that cwd=/tmp launch.
const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/neo4j-http-server.ts",
);

// Talks to Neo4j over the HTTP Query API v2 (443) instead of Bolt (7687).
// Use this when the Bolt port is not reachable from the pod but the HTTP
// listener is. Same tool surface as the official `mcp-neo4j-cypher`.
export const neo4jHttpAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "neo4j-http",
  credentialFields: [
    {
      name: "url",
      label: "Neo4j HTTP base URL",
      type: "text",
      placeholder: "https://neo4j.infra.staging.in1.hyperswitch.net",
    },
    {
      name: "database",
      label: "Database",
      type: "text",
      placeholder: "neo4j",
      optional: true,
    },
    {
      name: "username",
      label: "Username",
      type: "text",
      placeholder: "neo4j",
      optional: true,
    },
    {
      name: "password",
      label: "Password",
      type: "password",
      placeholder: "your-neo4j-password",
    },
    {
      name: "readOnly",
      label: "Read-only (true/false)",
      type: "text",
      placeholder: "true",
      optional: true,
    },
  ],
  healthCheck: {
    name: "read_neo4j_cypher",
    params: { query: "RETURN 1 AS ok" },
  },
  // write_neo4j_cypher is only exposed by the server when readOnly=false; mark
  // it here so it always requires approval when it IS exposed.
  writeTools: ["write_neo4j_cypher"],
  buildCommand(credentials) {
    const url = String(credentials["url"] ?? "").trim();
    const database = String(credentials["database"] ?? "neo4j").trim() || "neo4j";
    const username = String(credentials["username"] ?? "neo4j").trim() || "neo4j";
    const password = String(credentials["password"] ?? "");
    // Default to read-only unless explicitly set to "false".
    const readOnly = String(credentials["readOnly"] ?? "true").trim().toLowerCase() !== "false";
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        NEO4J_HTTP_URL: url,
        NEO4J_DATABASE: database,
        NEO4J_USERNAME: username,
        NEO4J_PASSWORD: password,
        NEO4J_READ_ONLY: readOnly ? "true" : "false",
      },
    };
  },
};
