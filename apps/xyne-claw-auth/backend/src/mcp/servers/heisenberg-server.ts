import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { errMsg } from "../../lib/errors.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { HEISENBERG_TOOLS } from "./heisenberg-tools.js";

const server = new Server(
  { name: "heisenberg", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: HEISENBERG_TOOLS.map(({ handler: _handler, ...tool }) => tool),
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  const tool = HEISENBERG_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown Heisenberg tool: ${name}` }],
      isError: true,
    };
  }

  try {
    return await tool.handler((args ?? {}) as Record<string, unknown>);
  } catch (error) {
    const message = errMsg(error);
    process.stderr.write(`[heisenberg-server] tool=${name} failed: ${message}\n`);
    return {
      content: [{ type: "text", text: `Heisenberg MCP error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[heisenberg-server] Connected and listening on stdio\n");

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});
