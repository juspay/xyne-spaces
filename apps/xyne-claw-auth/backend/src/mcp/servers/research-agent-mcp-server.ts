/**
 * Research Agent MCP server — stdio proxy for the Research Agent REST tools.
 *
 * Tools are discovered from the Research Agent manifest endpoint and proxied to
 * the matching REST endpoints. Authentication is deliberately non-interactive:
 * the API key is injected by xyne-claw-auth through env/config, not collected by
 * a browser login flow inside the child process.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { errMsg } from "../../lib/errors.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

interface ManifestTool {
  name: string;
  description?: string;
  method: string;
  path: string;
  path_params?: string[];
  input_schema?: Record<string, unknown>;
}

interface Manifest {
  api_prefix?: string;
  auth?: { header?: string };
  tools: ManifestTool[];
}

const SERVER_URL = (
  process.env["RESEARCH_AGENT_MCP_SERVER_URL"] ??
  process.env["RESEARCH_AGENT_BASE_URL"] ??
  "<research-agent-url>"
).replace(/\/+$/, "");

// Support both the explicitly requested env name and the conventional uppercase form.
const API_KEY =
  process.env["RESEARCH_AGENT_MCP_API_KEY"] ??
  process.env["research_agent_mcp_api_key"] ??
  "";

const MANIFEST_PATHS = ["/api/crud/research-agent/tools-manifest"];
const REQUEST_TIMEOUT_MS = 120_000;

function apiKeyHeaders(header = "Authorization"): Record<string, string> {
  return { [header]: `ApiKey ${API_KEY}` };
}

function appendParameterDescription(tool: ManifestTool): string {
  const schema = (tool.input_schema ?? {}) as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  if (Object.keys(props).length === 0) return "";
  const lines = Object.entries(props).map(([name, prop]) => {
    const type = Array.isArray(prop.type) ? prop.type.find((t) => t !== "null") ?? "any" : prop.type ?? "any";
    const req = required.has(name) ? " (required)" : "";
    const def = Object.prototype.hasOwnProperty.call(prop, "default") ? `, default=${JSON.stringify(prop.default)}` : "";
    return `  ${name}: ${type}${def}${req}`;
  });
  return `\nParameters:\n${lines.join("\n")}`;
}

async function fetchText(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { ok: res.ok, status: res.status, text: await res.text().catch(() => "") };
}

async function loadManifests(failOnAuth: boolean): Promise<Manifest[]> {
  if (!API_KEY) {
    if (failOnAuth) throw new Error("RESEARCH_AGENT_MCP_API_KEY is not set");
    return [];
  }

  const manifests: Manifest[] = [];
  for (const path of MANIFEST_PATHS) {
    const url = `${SERVER_URL}${path}`;
    const res = await fetchText(url, { headers: apiKeyHeaders() });
    if (res.status === 401) {
      if (failOnAuth) throw new Error("Invalid Research Agent MCP API key");
      console.error("[research-agent-mcp] API key rejected while listing tools");
      return [];
    }
    if (!res.ok) {
      console.error(`[research-agent-mcp] skipping manifest ${path}: HTTP ${res.status}: ${res.text.slice(0, 500)}`);
      continue;
    }
    manifests.push(JSON.parse(res.text) as Manifest);
  }
  return manifests;
}

function manifestToolToMcpTool(tool: ManifestTool): Tool {
  return {
    name: tool.name,
    description: `${tool.description ?? ""}${appendParameterDescription(tool)}`,
    inputSchema: (tool.input_schema ?? { type: "object", properties: {} }) as Tool["inputSchema"],
  };
}

async function findTool(name: string): Promise<{ manifest: Manifest; tool: ManifestTool } | null> {
  for (const manifest of await loadManifests(true)) {
    const tool = manifest.tools.find((t) => t.name === name);
    if (tool) return { manifest, tool };
  }
  return null;
}

function formatResponse(text: string): string {
  // No size cap. claw's promoteIfOversized() is the single context-size guard —
  // it spills an over-large result to a file behind a preview, so the full
  // response is preserved and the model can read/grep it or narrow the request.
  let formatted = text;
  try {
    formatted = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Keep non-JSON / plain string responses as-is.
  }
  return formatted;
}

async function callProxyTool(tool: ManifestTool, manifest: Manifest, args: Record<string, unknown>): Promise<CallToolResult> {
  const method = tool.method.toUpperCase();
  const apiPrefix = manifest.api_prefix ?? "/api/crud";
  const authHeader = manifest.auth?.header ?? "Authorization";
  const pathParams = tool.path_params ?? [];
  const remaining: Record<string, unknown> = { ...args };

  let path = tool.path;
  for (const param of pathParams) {
    const value = remaining[param];
    if (value == null) {
      return { content: [{ type: "text", text: `Missing required path parameter: ${param}` }], isError: true };
    }
    delete remaining[param];
    path = path.replace(`{${param}}`, encodeURIComponent(String(value)));
  }

  const url = new URL(`${SERVER_URL}${apiPrefix}${path}`);
  const headers = { "Content-Type": "application/json", ...apiKeyHeaders(authHeader) };
  const init: RequestInit = { method, headers };

  if (method === "GET") {
    for (const [key, value] of Object.entries(remaining)) {
      if (value != null) url.searchParams.set(key, String(value));
    }
  } else {
    init.body = JSON.stringify(Object.fromEntries(Object.entries(remaining).filter(([, value]) => value != null)));
  }

  const res = await fetchText(url.toString(), init);
  if (res.status === 401) {
    return { content: [{ type: "text", text: "Invalid Research Agent MCP API key" }], isError: true };
  }
  if (!res.ok) {
    return { content: [{ type: "text", text: `HTTP ${res.status}: ${res.text.slice(0, 500)}` }], isError: true };
  }
  return { content: [{ type: "text", text: formatResponse(res.text) }] };
}

const server = new Server(
  { name: "research-agent-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const PING_TOOL: Tool = {
  name: "ping",
  description: "Local health check — confirms the Research Agent MCP stdio server is running.",
  inputSchema: { type: "object", properties: {} },
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const manifests = await loadManifests(false);
  const tools = manifests.flatMap((manifest) => manifest.tools.map(manifestToolToMcpTool));
  return { tools: [PING_TOOL, ...tools] };
});

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  if (name === "ping") return { content: [{ type: "text", text: "ok" }] };

  try {
    const resolved = await findTool(name);
    if (!resolved) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    return callProxyTool(resolved.tool, resolved.manifest, (args ?? {}) as Record<string, unknown>);
  } catch (err) {
    const msg = errMsg(err);
    return { content: [{ type: "text", text: `research-agent-mcp error: ${msg}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[research-agent-mcp-server] Connected and listening on stdio");

process.on("SIGINT", async () => { await server.close(); process.exit(0); });
process.on("SIGTERM", async () => { await server.close(); process.exit(0); });
