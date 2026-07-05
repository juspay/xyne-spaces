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
const userId = process.env["XYNE_USER_ID"] ?? "";
// "app" → run is an agent's app user (token is the app token; tools use the
// /api/apps/* routes). "user" → real user session (token is the session JWT;
// tools use /api/query). Default "user" preserves existing behaviour.
const authMode: "user" | "app" = process.env["XYNE_SPACES_AUTH_MODE"] === "app" ? "app" : "user";

if (!url || !token) {
  process.stderr.write("xyne-spaces-server: XYNE_SPACES_URL and XYNE_SPACES_TOKEN must be set\n");
  process.exit(1);
}

const directVespa = process.env["DIRECT_VESPA_SEARCH"] === "true";
const vespaEndpoint = process.env["VESPA_QUERY_ENDPOINT"] ?? "http://localhost:8081";
if (directVespa && vespaEndpoint.includes("localhost")) {
  process.stderr.write(
    `[xyne-spaces-server] WARNING: DIRECT_VESPA_SEARCH=true but VESPA_QUERY_ENDPOINT is still "${vespaEndpoint}" — ` +
    "set VESPA_QUERY_ENDPOINT to the production Vespa search node in non-local environments\n",
  );
}

const server = new Server(
  { name: "xyne-spaces", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// Advertise ALL tools in both modes. App-mode runs now work through the regular
// `handler` too: the spaces tools call the `/api/*/claw` endpoints (XYNE-12345)
// which accept the agent's app token, so a user session is no longer required.
// `appHandler` stays an optimization for tools with a dedicated /api/apps/* route
// (preferred in app mode when present, see CallTool below). Previously app mode
// hid every tool without an appHandler — which left app-user runs with only
// `spaces-channels` and unable to read messages/tickets. The few tools still on
// non-/claw endpoints (update-ticket, attachment download) now 401 at CALL time
// with a clear error instead of the whole toolset being hidden.
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
  // App mode: prefer a tool's dedicated app-token implementation (the
  // /api/apps/* path) when it has one; otherwise fall through to the regular
  // handler — which works in app mode because the spaces tools hit the
  // app-token-capable /claw endpoints.
  if (authMode === "app" && tool.appHandler) {
    return tool.appHandler(args ?? {}, { userId, authMode });
  }
  return tool.handler(args ?? {}, { userId, authMode });
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
