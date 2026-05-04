import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const TOKEN = process.env["XYNE_SPACE_TOKEN"] ?? "";
const JUSPAY_TOKEN = process.env["JUSPAY_TOKEN"] ?? "";
const POMERIUM_COOKIE = process.env["JUSPAY_POMERIUM_COOKIE"] ?? "";
const BASE_URL = "https://lightbox.sso.internal.svc.k8s.apoc.mum.juspay.net/api/juspay-internal/xyne-tools";

const server = new Server(
  { name: "juspay-internal-tools", version: "0.1.0" },
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
      name: "fetch_merchant_flow",
      description: "Fetch merchant workflow from Juspay Turing",
      inputSchema: {
        type: "object",
        properties: {
          merchant_id: { type: "string", description: "Merchant ID" },
          product_name: { type: "string", description: "Product name (e.g. EC_SDK)" },
          merchant_type: { type: "string", description: "Merchant type (e.g. F1)" },
          scenario: { type: "string", description: "Scenario (e.g. onboarding)" },
        },
        required: ["merchant_id", "product_name", "merchant_type", "scenario"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;

  if (name === "ping") {
    return { content: [{ type: "text", text: "ok" }] };
  }

  if (name === "fetch_merchant_flow") {
    try {
      const bodyArgs: Record<string, unknown> = { ...(args ?? {}), juspay_token: JUSPAY_TOKEN };

      const response = await fetch(`${BASE_URL}/fetch-merchant-flow`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Xyne-Space-Token": TOKEN,
          ...(POMERIUM_COOKIE ? { Cookie: `_pomerium=${POMERIUM_COOKIE}` } : {}),
        },
        body: JSON.stringify(bodyArgs),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          content: [{ type: "text", text: `HTTP ${response.status}: ${text.slice(0, 500)}` }],
          isError: true,
        };
      }

      const data = await response.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error calling fetch_merchant_flow: ${message}` }],
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
console.error("[juspay-internal-tools-server] Connected and listening on stdio");

process.on("SIGINT", async () => { await server.close(); process.exit(0); });
process.on("SIGTERM", async () => { await server.close(); process.exit(0); });
