/**
 * Xyne Dashboard MCP server — standalone process spawned by the xyne-dashboard
 * adapter. Same skeleton as xyne-spaces-server; serves the dashboard-ai
 * agent's dedicated toolset (see xyne-dashboard-tools.ts).
 *
 * Reads XYNE_SPACES_URL and XYNE_SPACES_TOKEN from environment variables.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { tools } from "./xyne-dashboard-tools.js";

const url = process.env["XYNE_SPACES_URL"];
const token = process.env["XYNE_SPACES_TOKEN"];
const userId = process.env["XYNE_USER_ID"] ?? "";

if (!url || !token) {
  process.stderr.write("xyne-dashboard-server: XYNE_SPACES_URL and XYNE_SPACES_TOKEN must be set\n");
  process.exit(1);
}

const server = new Server(
  { name: "xyne-dashboard", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  return tool.handler(args ?? {}, { userId });
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});
