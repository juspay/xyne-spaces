import { BUILTIN_SERVER_CMD } from "xyne-claw-mcp-common/protocol";
import type { StdioMcpAdapter } from "../types.js";

// Runs as `xyne-mcp-server neo4j-http-server`.

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
      cmd: BUILTIN_SERVER_CMD,
      args: ["neo4j-http-server"],
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
