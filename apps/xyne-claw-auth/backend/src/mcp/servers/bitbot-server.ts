/**
 * BITBOT MCP server — proxies the Juspay PR analysis service. Single tool:
 *
 *   bulk_prs(repos, from_date, to_date, state)
 *     POST {BASE_URL}/api/prs/bulk
 *
 * Modelled after juspay-internal-tools-server.ts — same response truncation
 * guard, same error shape, stdio transport.
 *
 * No application-layer auth — pr-analysis gates access by NAT-IP allowlist
 * on the network side, so we just need our cluster's egress IPs whitelisted.
 *
 * Env:
 *   BITBOT_BASE_URL  (default: <research-agent-url>)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { errMsg } from "../../lib/errors.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

// BITBOT_BASE_URL is set by adapters/bitbot.ts from CONFIG.bitbotBaseUrl when
// this server is spawned via the MCP adapter — that's the production path.
// The inline default is just a safety net for direct-invocation testing
// (e.g. `node --import tsx/esm src/mcp/servers/bitbot-server.ts`); change the
// real default in src/config.ts, NOT here.
const BASE_URL =
  process.env["BITBOT_BASE_URL"] ??
  "<research-agent-url>";

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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyArgs),
      signal: AbortSignal.timeout(60_000),
    });

    const text = await response.text().catch(() => "");

    if (!response.ok) {
      return {
        content: [{ type: "text", text: `HTTP ${response.status}: ${text.slice(0, 500)}` }],
        isError: true,
      };
    }

    // No size cap here. claw's promoteIfOversized() is the single context-size
    // guard: bulk PR queries that return tens of MB are spilled to a file behind
    // a preview, so the full body is preserved and the model can read/grep it or
    // re-call with a narrower date range / repo list.
    return { content: [{ type: "text", text: parseResponseText(text) }] };
  } catch (error) {
    const message = errMsg(error);
    const cause = (error as { cause?: unknown })?.cause;
    const causeStr = cause
      ? JSON.stringify(cause, Object.getOwnPropertyNames(cause as object))
      : "(no cause)";
    console.error(
      `[bitbot] ${toolName} fetch fail name=${(error as Error)?.name} msg=${message} cause=${causeStr}`,
    );
    return {
      content: [
        { type: "text", text: `Error calling ${toolName}: ${message} | cause=${causeStr}` },
      ],
      isError: true,
    };
  }
};

const server = new Server(
  { name: "bitbot", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ping",
      description: "Local health check — returns ok without contacting the upstream API.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "bulk_prs",
      description:
        "Fetch pull requests across one or more Bitbucket repos via the in-cluster " +
        "pr-analysis service. Use this when the user asks for a PR digest, recent " +
        "merges, open-PR summary, or activity report scoped to specific repos and a " +
        "date range. Returns the count + full PR objects (id, state, branches, title, " +
        "description, timestamps, jira_keys, author) grouped by PROJECT/REPO. " +
        "Date format: YYYY-MM-DD. The upstream service tolerates DD-MM-YYYY for " +
        "to_date — prefer ISO YYYY-MM-DD for both bounds for consistency.",
      inputSchema: {
        type: "object",
        properties: {
          repos: {
            type: "array",
            description:
              "List of repos to query. Each entry must include both project_key " +
              "(Bitbucket project, e.g. JBIZ / JUSPAY / EXC / IRIS / JUSAI) and " +
              "repo_name (e.g. euler-api-txns).",
            items: {
              type: "object",
              properties: {
                repo_name: { type: "string", description: "Bitbucket repo slug, e.g. euler-api-txns" },
                project_key: { type: "string", description: "Bitbucket project key, e.g. JBIZ" },
              },
              required: ["repo_name", "project_key"],
            },
            minItems: 1,
          },
          from_date: {
            type: "string",
            description: "Inclusive lower bound, YYYY-MM-DD. PRs created on/after this date.",
          },
          to_date: {
            type: "string",
            description: "Inclusive upper bound, YYYY-MM-DD. PRs created on/before this date.",
          },
          state: {
            type: "string",
            description:
              "PR state filter. Common values: ALL (default), OPEN, MERGED, DECLINED.",
            default: "ALL",
          },
        },
        required: ["repos", "from_date", "to_date"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;

  if (name === "ping") {
    return { content: [{ type: "text", text: "ok" }] };
  }

  if (name === "bulk_prs") {
    const bodyArgs: Record<string, unknown> = { ...(args ?? {}) };
    // Default state to ALL — matches the upstream service's documented default
    // and keeps a wider net when the agent doesn't pin it explicitly.
    if (bodyArgs["state"] == null) bodyArgs["state"] = "ALL";
    return postJsonTool(name, "/api/prs/bulk", bodyArgs);
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[bitbot-server] Connected and listening on stdio");

process.on("SIGINT", async () => { await server.close(); process.exit(0); });
process.on("SIGTERM", async () => { await server.close(); process.exit(0); });
