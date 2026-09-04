/**
 * Query Routing MCP server — standalone process spawned by the query-routing adapter.
 *
 * Communicates with the parent (xyne-claw-auth runner) via stdio using the MCP protocol.
 * Reads QUERY_ROUTING_HOST, QUERY_ROUTING_TOKEN, QUERY_ROUTING_AGENT, and
 * QUERY_ROUTING_SOURCE from environment variables.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { errMsg } from "../../lib/errors.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const HOST = (process.env["QUERY_ROUTING_HOST"] ?? "").replace(/\/+$/, "");
const TOKEN = process.env["QUERY_ROUTING_TOKEN"] ?? "";
const AGENT = process.env["QUERY_ROUTING_AGENT"] || "investigation";
const SOURCE = process.env["QUERY_ROUTING_SOURCE"] || "xyne_spaces";

if (!HOST || !TOKEN) {
  process.stderr.write("query-routing-server: QUERY_ROUTING_HOST and QUERY_ROUTING_TOKEN must be set\n");
  process.exit(1);
}

const server = new Server(
  { name: "query-routing", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ping",
      description: "Local health check — returns ok without contacting the upstream API",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "query_routing",
      description:
        "Send a query to the query_routing API. Routes a natural-language query " +
        "(e.g. \"Check merchant status\") to the appropriate backend investigation flow.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The natural-language query to route (e.g. \"Check merchant status\")",
          },
          email: {
            type: "string",
            description: "Email of the user/merchant the query is being run for",
          },
          override_mid: {
            type: "string",
            description: "Optional merchant ID to override",
          },
        },
        required: ["query", "email"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;

  if (name === "ping") {
    return { content: [{ type: "text", text: "ok" }] };
  }

  if (name === "query_routing") {
    try {
      const query = args?.["query"] as string | undefined;
      const email = args?.["email"] as string | undefined;
      const overrideMid = args?.["override_mid"] as string | undefined;

      if (!query || !email) {
        return {
          content: [{ type: "text", text: "Both 'query' and 'email' are required parameters." }],
          isError: true,
        };
      }

      const payload: Record<string, unknown> = {
        query,
        agent: AGENT,
        source: SOURCE,
        email,
      };
      if (overrideMid) {
        payload["override_mid"] = overrideMid;
      }

      const url = `${HOST}/api/v3/query_routing/`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${TOKEN}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          content: [{ type: "text", text: `HTTP ${response.status}: ${text}` }],
          isError: true,
        };
      }

      const rawText = await response.text().catch(() => "");
      let data: unknown;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { status_code: response.status, text: rawText };
      }

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      const message = errMsg(error);
      return {
        content: [{ type: "text", text: `Error calling query_routing: ${message}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[query-routing-server] Connected and listening on stdio");

process.on("SIGINT", async () => { await server.close(); process.exit(0); });
process.on("SIGTERM", async () => { await server.close(); process.exit(0); });
