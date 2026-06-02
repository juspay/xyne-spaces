import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const TOKEN = process.env["JUSPAY_INTERNAL_TOOLS_VALIDATE_TOKEN"] ?? "";
const BASE_URL =
  process.env["JUSPAY_INTERNAL_TOOLS_BASE_URL"] ??
  "http://juspay-internal-tools-ext.internal.svc.k8s.dozer.mum.juspay.net/";

const buildEndpoint = (path: string): string =>
  `${BASE_URL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;

const parseResponseText = (text: string): string => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

const postJsonTool = async (
  toolName: string,
  path: string,
  bodyArgs: Record<string, unknown>,
): Promise<CallToolResult> => {
  try {
    const response = await fetch(buildEndpoint(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Xyne-Space-Token": TOKEN,
      },
      body: JSON.stringify(bodyArgs),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await response.text().catch(() => "");

    if (!response.ok) {
      return {
        content: [{ type: "text", text: `HTTP ${response.status}: ${text.slice(0, 500)}` }],
        isError: true,
      };
    }

    // Global safety net: upstream payloads can exceed the agent's context
    // window (Curie *_fetch_all endpoints return unbounded arrays). Cap raw
    // body before parsing so we never hand a 200k-char blob to the LLM.
    // Tools that support pagination should set their own limit; this is the
    // last-resort guard for everything else.
    const MAX_CHARS = 40_000;
    if (text.length > MAX_CHARS) {
      const truncated = text.slice(0, MAX_CHARS);
      const notice = `\n\n[TRUNCATED: response was ${text.length} chars, showing first ${MAX_CHARS}. If this tool supports limit/offset, reduce limit or paginate.]`;
      return { content: [{ type: "text", text: truncated + notice }] };
    }

    return { content: [{ type: "text", text: parseResponseText(text) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = (error as { cause?: unknown })?.cause;
    const causeStr = cause
      ? JSON.stringify(cause, Object.getOwnPropertyNames(cause as object))
      : "(no cause)";
    console.error(
      `[juspay-internal-tools] ${toolName} fetch fail name=${(error as Error)?.name} msg=${message} cause=${causeStr}`,
    );
    return {
      content: [
        {
          type: "text",
          text: `Error calling ${toolName}: ${message} | cause=${causeStr}`,
        },
      ],
      isError: true,
    };
  }
};

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
    {
      name: "fetch_merchant_onboarding_progress",
      description:
        "Fetch merchant onboarding progress from Juspay internal tools. " +
        "Returns successfull_response and failure_response arrays with active steps/substeps, ETA, lagging status, product, scenario, and merchant type.",
      inputSchema: {
        type: "object",
        properties: {
          merchant_id: { type: "string", description: "Merchant ID, for example peppy" },
          client_id: { type: "string", description: "Optional client ID" },
          product_info_ids: {
            type: "array",
            description: "Optional product info IDs to filter by, such as EC_SDK",
            items: { type: "string" },
          },
          allow_dropped: { type: "boolean", description: "Include dropped progress entries" },
          allow_current_progress: { type: "boolean", description: "Include current progress" },
          allow_completed_substep_count: { type: "boolean", description: "Include completed substep counts" },
          allow_flow_timestamps: { type: "boolean", description: "Include flow timestamps" },
          start_time: { type: "string", description: "Optional start time, format YYYY-MM-DD HH:mm:ss" },
          end_time: { type: "string", description: "Optional end time, format YYYY-MM-DD HH:mm:ss" },
        },
        required: ["merchant_id"],
      },
    },
    {
      name: "stein_list_features",
      description: "List Stein features for a merchant from Juspay internal tools",
      inputSchema: {
        type: "object",
        properties: {
          merchant_id: { type: "string", description: "Merchant ID" },
          client_id: {
            type: ["string", "null"],
            description: "Optional client ID; use null when not applicable",
          },
        },
        required: ["merchant_id"],
      },
    },
    {
      name: "curie_lead_fetch_all",
      description:
        "Fetch Curie leads with optional filters. Returns up to 20 leads per call by default. " +
        "For more results, call again with offset incremented by limit (e.g. offset=20, then 40).",
      inputSchema: {
        type: "object",
        properties: {
          orgId: { type: "string", description: "Optional organization ID" },
          merchantId: { type: "string", description: "Optional merchant ID" },
          lobId: { type: "string", description: "Optional line-of-business ID" },
          team: { type: "string", description: "Optional team filter" },
          bdkam: { type: "string", description: "Optional BD/KAM email" },
          source: { type: "string", description: "Optional lead source" },
          status: { type: "string", description: "Optional lead status" },
          merchantTrack: { type: "string", description: "Optional merchant track" },
          stage: { type: "string", description: "Optional stage" },
          agreementExecutionStage: { type: "string", description: "Optional agreement execution stage" },
          country: { type: "string", description: "Optional country code" },
          merchantIdType: { type: "string", description: "Optional merchant ID type" },
          product: { type: "string", description: "Optional product" },
          industry: { type: "string", description: "Optional industry" },
          limit: { type: "number", description: "Page size (defaults to 20)", default: 20 },
          offset: { type: "number", description: "Page offset (defaults to 0)", default: 0 },
        },
      },
    },
    {
      name: "curie_lead_fetch_one",
      description: "Fetch one Curie lead by lead ID via Xyne tools wrapper",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Lead ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "curie_org_fetch_all",
      description: "Fetch all Curie organizations with optional filters via Xyne tools wrapper",
      inputSchema: {
        type: "object",
        properties: {
          bdkam: { type: "array", items: { type: "string" }, description: "Optional BD/KAM list" },
          product: { type: "array", items: { type: "string" }, description: "Optional product list" },
          industry: { type: "array", items: { type: "string" }, description: "Optional industry list" },
          stage: { type: "array", items: { type: "string" }, description: "Optional stage list" },
          merchantTrack: { type: "array", items: { type: "string" }, description: "Optional merchant track list" },
          merchantIdType: { type: "array", items: { type: "string" }, description: "Optional merchant ID type list" },
          source: { type: "array", items: { type: "string" }, description: "Optional source list" },
          status: { type: "array", items: { type: "string" }, description: "Optional status list" },
          agreementExecutionStage: { type: "array", items: { type: "string" }, description: "Optional agreement stage list" },
          country: { type: "array", items: { type: "string" }, description: "Optional country list" },
          time_range_from: { type: "string", description: "Optional start time" },
          time_range_to: { type: "string", description: "Optional end time" },
        },
      },
    },
    {
      name: "curie_org_fetch_one",
      description: "Fetch one Curie organization by org ID via Xyne tools wrapper",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Organization ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "curie_ticket_overall",
      description: "Fetch Curie ticket overall summary with optional filters via Xyne tools wrapper",
      inputSchema: {
        type: "object",
        properties: {
          ticket_time_range_from: { type: "string", description: "Optional start time" },
          ticket_time_range_to: { type: "string", description: "Optional end time" },
          teams: { type: "array", items: { type: "string" } },
          coAssignees: { type: "array", items: { type: "string" } },
          integrationScopes: { type: "array", items: { type: "string" } },
          assignees: { type: "array", items: { type: "string" } },
          stages: { type: "array", items: { type: "string" } },
          integrationTypes: { type: "array", items: { type: "string" } },
          industries: { type: "array", items: { type: "string" } },
          bdList: { type: "array", items: { type: "string" } },
          platforms: { type: "array", items: { type: "string" } },
          pgs: { type: "array", items: { type: "string" } },
          pmts: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "curie_ticket_summary",
      description: "Fetch Curie ticket summary with optional filters via Xyne tools wrapper",
      inputSchema: {
        type: "object",
        properties: {
          ticket_time_range_from: { type: "string", description: "Optional start time" },
          ticket_time_range_to: { type: "string", description: "Optional end time" },
          teams: { type: "array", items: { type: "string" } },
          coAssignees: { type: "array", items: { type: "string" } },
          integrationScopes: { type: "array", items: { type: "string" } },
          assignees: { type: "array", items: { type: "string" } },
          stages: { type: "array", items: { type: "string" } },
          integrationTypes: { type: "array", items: { type: "string" } },
          industries: { type: "array", items: { type: "string" } },
          bdList: { type: "array", items: { type: "string" } },
          platforms: { type: "array", items: { type: "string" } },
          pgs: { type: "array", items: { type: "string" } },
          pmts: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "curie_integration_ticket_fetch",
      description: "Fetch one Curie integration ticket by ticket ID via Xyne tools wrapper",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Ticket ID" },
        },
        required: ["id"],
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
    const bodyArgs: Record<string, unknown> = { ...(args ?? {}) };
    return postJsonTool(name, "/fetch-merchant-flow", bodyArgs);
  }

  if (name === "fetch_merchant_onboarding_progress") {
    const bodyArgs: Record<string, unknown> = { ...(args ?? {}) };
    return postJsonTool(name, "/fetch-merchant-onboarding-progress", bodyArgs);
  }

  if (name === "stein_list_features") {
    const bodyArgs: Record<string, unknown> = { ...(args ?? {}) };
    return postJsonTool(name, "/stein-list-features", bodyArgs);
  }

  if (name === "curie_lead_fetch_all") {
    const bodyArgs: Record<string, unknown> = { ...(args ?? {}) };
    // Force pagination defaults: upstream returns unbounded array otherwise,
    // which has overflowed the agent context window (~245k tokens). Use
    // `== null` so explicit `limit: 0` from the caller still wins.
    if (bodyArgs["limit"] == null) bodyArgs["limit"] = 20;
    if (bodyArgs["offset"] == null) bodyArgs["offset"] = 0;
    return postJsonTool(name, "/curie-lead-fetch-all", bodyArgs);
  }

  if (name === "curie_lead_fetch_one") {
    const bodyArgs: Record<string, unknown> = { ...(args ?? {}) };
    return postJsonTool(name, "/curie-lead-fetch-one", bodyArgs);
  }

  if (name === "curie_org_fetch_all") {
    const bodyArgs: Record<string, unknown> = { ...(args ?? {}) };
    return postJsonTool(name, "/curie-org-fetch-all", bodyArgs);
  }

  if (name === "curie_org_fetch_one") {
    const bodyArgs: Record<string, unknown> = { ...(args ?? {}) };
    return postJsonTool(name, "/curie-org-fetch-one", bodyArgs);
  }

  if (name === "curie_ticket_overall") {
    const bodyArgs: Record<string, unknown> = { ...(args ?? {}) };
    return postJsonTool(name, "/curie-ticket-overall", bodyArgs);
  }

  if (name === "curie_ticket_summary") {
    const bodyArgs: Record<string, unknown> = { ...(args ?? {}) };
    return postJsonTool(name, "/curie-ticket-summary", bodyArgs);
  }

  if (name === "curie_integration_ticket_fetch") {
    const bodyArgs: Record<string, unknown> = { ...(args ?? {}) };
    return postJsonTool(name, "/curie-integration-ticket-fetch", bodyArgs);
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
