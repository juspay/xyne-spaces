import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SDLC_MCP_SERVER_TYPE } from "xyne-claw-shared";
import { sdlcTools } from "./xyne-spaces-tools.js";

const url = process.env["XYNE_SPACES_URL"];
const token = process.env["XYNE_SPACES_TOKEN"];
const userId = process.env["XYNE_USER_ID"] ?? "";
const authMode: "user" | "app" = process.env["XYNE_SPACES_AUTH_MODE"] === "app" ? "app" : "user";

if (!url || !token) {
  process.stderr.write("xyne-spaces-sdlc-server: XYNE_SPACES_URL and XYNE_SPACES_TOKEN must be set\n");
  process.exit(1);
}

const server = new Server(
  { name: SDLC_MCP_SERVER_TYPE, version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: sdlcTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  const tool = sdlcTools.find((t) => t.name === name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  return tool.handler(args ?? {}, { userId, authMode });
});

const transport = new StdioServerTransport();
await server.connect(transport);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
