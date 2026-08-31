/**
 * Google MCP server — standalone process spawned by the `google` stdio adapter.
 *
 * Reuses the existing Google tool implementations from xyne-claw-shared (the
 * same `ToolDefinition`s that used to run in-process inside xyne-claw as
 * "custom:google" tools). Communicates with the parent (xyne-claw-auth runner)
 * over stdio using the MCP protocol.
 *
 * Credentials: a fresh `GOOGLE_ACCESS_TOKEN` is injected into the env by the
 * adapter's buildCommand (resolved + refreshed by the credential-loader). The
 * tool handlers read it from `ctx.config["GOOGLE_ACCESS_TOKEN"]`.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { errMsg } from "../../lib/errors.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getAllCustomTools } from "xyne-claw-shared";

const token = process.env["GOOGLE_ACCESS_TOKEN"];
if (!token) {
  process.stderr.write("google-server: GOOGLE_ACCESS_TOKEN must be set\n");
  process.exit(1);
}

// Reuse the shared Google tool definitions. Filtering by source keeps this in
// lockstep with whatever google-* tools xyne-claw-shared ships — no per-tool
// list to maintain here.
const tools = getAllCustomTools().filter((t) => t.source === "custom:google");

const server = new Server(
  { name: "google", version: "0.1.0" },
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
    const ctx = { config: { GOOGLE_ACCESS_TOKEN: token } };
    // Citation-aware tools (gmail/calendar/drive search+read) return inline
    // `[clf-__TOOL_CALL_ID__#n]` tokens in their text AND a structured
    // Citation[]. Surface the citations in MCP `_meta.citations` so claw-auth's
    // generic callTool() forwards them and the dashboard renders source chips.
    // Plain tools (writes, contacts, tasks) keep the string-only `execute` path.
    if (tool.executeCited) {
      const { text, citations } = await tool.executeCited(args ?? {}, ctx);
      return citations && citations.length > 0
        ? { content: [{ type: "text", text }], _meta: { citations } }
        : { content: [{ type: "text", text }] };
    }
    const text = await tool.execute(args ?? {}, ctx);
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
