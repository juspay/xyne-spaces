import type { StdioMcpAdapter } from "../types.js";

// Mirrors the live prod DB row's launchConfigTemplate. Manages Aura DB
// instances themselves (create/resize/delete) via Neo4j's Aura Management
// API — distinct from adapters/neo4j-http.ts, which queries data inside a
// single database.
export const neo4jAuraAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "neo4j-aura",
  healthCheck: { name: "__list_tools__", params: {} },
  credentialFields: [
    { name: "clientId", label: "Aura Client ID", type: "text", placeholder: "Profile menu → Client credentials → Create" },
    { name: "clientSecret", label: "Aura Client Secret", type: "password", placeholder: "Shown once at creation" },
  ],
  writeTools: [],
  buildCommand(credentials) {
    return {
      cmd: "uvx",
      args: ["mcp-neo4j-aura-manager@0.4.8"],
      env: {
        NEO4J_AURA_CLIENT_ID: credentials["clientId"] as string,
        NEO4J_AURA_CLIENT_SECRET: credentials["clientSecret"] as string,
      },
    };
  },
};
