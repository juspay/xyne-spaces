/**
 * Microsoft MCP server — standalone process spawned by the `microsoft` stdio
 * adapter.
 *
 * Reuses the existing Microsoft tool implementations from xyne-claw-shared (the
 * same `ToolDefinition`s that used to run in-process inside xyne-claw as
 * "custom:microsoft" tools). Communicates with the parent (xyne-claw-auth
 * runner) over stdio using the MCP protocol.
 *
 * Credentials: a fresh `MICROSOFT_ACCESS_TOKEN` is injected into the env by the
 * adapter's buildCommand (resolved + refreshed by the credential-loader). The
 * tool handlers read it from `ctx.config["MICROSOFT_ACCESS_TOKEN"]`.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { errMsg } from "../../lib/errors.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getAllCustomTools } from "xyne-claw-shared";

const token = process.env["MICROSOFT_ACCESS_TOKEN"];
if (!token) {
  process.stderr.write("microsoft-server: MICROSOFT_ACCESS_TOKEN must be set\n");
  process.exit(1);
}

const tools = getAllCustomTools().filter((t) => t.source === "custom:microsoft");

const server = new Server(
  { name: "microsoft", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.slug,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  const tool = tools.find((t) => t.slug === name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    const text = await tool.execute(args ?? {}, { config: { MICROSOFT_ACCESS_TOKEN: token } });
    return { content: [{ type: "text", text }] };
  } catch (e) {
    return { content: [{ type: "text", text: errMsg(e) }], isError: true };
  }
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
