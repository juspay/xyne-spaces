// The npx MCP provisioner lives in xyne-claw-shared so xyne-claw and
// xyne-claw-auth run one implementation. Re-exported here so import paths and
// vi.mock("./provision.js") in tests keep working.
export * from "xyne-claw-shared/mcp-provision";
