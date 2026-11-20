// Minimal stdio MCP server for mcp-service tests. Reports the credential it was
// started with (FIXTURE_TOKEN) and whether any claw-auth secret leaked into it.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "echo", version: "0.0.1" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "echo", description: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "echo") {
    return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }], isError: true };
  }
  const report = {
    text: request.params.arguments?.text ?? "",
    token: process.env.FIXTURE_TOKEN ?? "",
    pid: process.pid,
    meta: request.params._meta ?? null,
    leaked: ["ENCRYPTION_KEY", "DATABASE_URL", "CLAW_SERVICE_PRIVATE_KEY"].filter((k) => process.env[k] !== undefined),
  };
  return { content: [{ type: "text", text: JSON.stringify(report) }] };
});

await server.connect(new StdioServerTransport());
