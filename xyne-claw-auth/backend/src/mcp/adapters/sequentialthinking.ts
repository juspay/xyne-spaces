import type { StdioMcpAdapter } from "../types.js";

export const sequencethinkingAdapter: StdioMcpAdapter = {
    transport: "stdio",
    type: "sequentialthinking",
    healthCheck: {
        name: "sequentialthinking",
        params: {
            thought: "Health check",
            nextThoughtNeeded: false,
            thoughtNumber: 1,
            totalThoughts: 1
        }
    },
    writeTools: [],
    credentialFields: [],
    buildCommand(_credentials) {
        return {
            cmd: "npx",
            args: ["-y", "@modelcontextprotocol/server-sequential-thinking@2025.12.18"],
            env: {},
        };
    },
};
