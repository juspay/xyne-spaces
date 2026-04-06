/**
 * Xyne Spaces MCP server — standalone process spawned by the xyne-spaces adapter.
 *
 * Communicates with the parent (xyne-claw-auth runner) via stdio using the MCP protocol.
 * Reads XYNE_SPACES_URL and XYNE_SPACES_TOKEN from environment variables.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { tools } from "./xyne-spaces-tools.js";

const url = process.env["XYNE_SPACES_URL"];
const token = process.env["XYNE_SPACES_TOKEN"];

if (!url || !token) {
  process.stderr.write("xyne-spaces-server: XYNE_SPACES_URL and XYNE_SPACES_TOKEN must be set\n");
  process.exit(1);
}

const server = new Server(
  { name: "xyne-spaces", version: "0.1.0" },
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
  return tool.handler(args ?? {});
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
