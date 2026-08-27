#!/usr/bin/env node
/**
 * Neo4j over the HTTP Query API — stdio MCP server.
 *
 * Drop-in replacement for `uvx mcp-neo4j-cypher` when the Bolt port (7687) is
 * NOT reachable from this pod but the HTTP listener (443) IS. The official
 * mcp-neo4j-cypher uses the Bolt-only Python driver, so it can only ever dial
 * `bolt(+s)://host:7687`. This server instead POSTs cypher to Neo4j's
 * **HTTP Query API v2** (`POST {base}/db/{database}/query/v2`), which rides the
 * same 443 path the rest of the cluster can already reach.
 *
 * It exposes the SAME tool names / shapes as the official server
 * (`get_neo4j_schema`, `read_neo4j_cypher`, `write_neo4j_cypher`) so agents
 * configured against the Bolt server keep working unchanged.
 *
 * Spawned by the parent backend via `node --import tsx/esm <this-file>` — see
 * src/mcp/adapters/neo4j-http.ts for the launch wiring.
 *
 * Config (all via env, set by the adapter from connector creds):
 *   NEO4J_HTTP_URL   — base URL, e.g. https://neo4j.infra.staging.in1.hyperswitch.net  (required)
 *   NEO4J_DATABASE   — database name (default: "neo4j")
 *   NEO4J_USERNAME   — basic-auth user (default: "neo4j")
 *   NEO4J_PASSWORD   — basic-auth password (required)
 *   NEO4J_READ_ONLY  — "true"/"false" (default: "true"). When true,
 *                      write_neo4j_cypher is refused and read_neo4j_cypher
 *                      rejects mutating clauses.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { errMsg } from "../../lib/errors.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

const RAW_BASE = (process.env["NEO4J_HTTP_URL"] ?? "").trim().replace(/\/+$/, "");
const DATABASE = (process.env["NEO4J_DATABASE"] ?? "neo4j").trim();
const USERNAME = (process.env["NEO4J_USERNAME"] ?? "neo4j").trim();
const PASSWORD = process.env["NEO4J_PASSWORD"] ?? "";
const READ_ONLY = (process.env["NEO4J_READ_ONLY"] ?? "true").trim().toLowerCase() !== "false";
const REQUEST_TIMEOUT_MS = Number(process.env["NEO4J_HTTP_TIMEOUT_MS"] ?? 60_000);

function logErr(msg: string): void {
  // stdout is the MCP transport; logs MUST go to stderr.
  console.error(`[neo4j-http] ${msg}`);
}

if (!RAW_BASE) {
  logErr("NEO4J_HTTP_URL env var is required — exiting");
  process.exit(1);
}
if (!PASSWORD) {
  logErr("NEO4J_PASSWORD env var is required — exiting");
  process.exit(1);
}

const QUERY_URL = `${RAW_BASE}/db/${encodeURIComponent(DATABASE)}/query/v2`;
const AUTH_HEADER = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;

// Clauses that mutate the graph. Used to keep read_neo4j_cypher honest when
// READ_ONLY is on (mirrors the official server's EXPLAIN-based gate, but
// cheaper — a single lexical pass). Matched case-insensitively on word
// boundaries so it won't trip on a property literally named "createdAt".
const WRITE_CLAUSE_RE =
  /\b(CREATE|MERGE|DELETE|DETACH\s+DELETE|SET|REMOVE|DROP|FOREACH|CALL\s*\{[^}]*\b(CREATE|MERGE|DELETE|SET|REMOVE)\b|LOAD\s+CSV)\b/i;

function looksLikeWrite(cypher: string): boolean {
  // Strip string literals + comments so keywords inside them don't false-trip.
  const stripped = cypher
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return WRITE_CLAUSE_RE.test(stripped);
}

interface QueryApiV2Response {
  data?: { fields?: string[]; values?: unknown[][] };
  errors?: Array<{ code?: string; message?: string }>;
  counters?: Record<string, unknown>;
  bookmarks?: string[];
}

/** POST a single cypher statement to the Query API v2 and return parsed rows. */
async function runCypher(
  statement: string,
  parameters: Record<string, unknown>,
): Promise<{ rows: Record<string, unknown>[]; counters?: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(QUERY_URL, {
      method: "POST",
      headers: {
        Authorization: AUTH_HEADER,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        statement,
        parameters,
        includeCounters: true,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = errMsg(err);
    throw new Error(`HTTP request to Query API failed (${QUERY_URL}): ${msg}`);
  }

  const text = await res.text();
  let body: QueryApiV2Response;
  try {
    body = text ? (JSON.parse(text) as QueryApiV2Response) : {};
  } catch {
    throw new Error(`Query API ${res.status} returned non-JSON (first 200 chars): ${text.slice(0, 200)}`);
  }

  // Neo4j surfaces cypher/auth errors in an `errors[]` array, sometimes with a
  // 2xx status. Treat either a non-ok status or a populated errors[] as failure.
  if (body.errors && body.errors.length > 0) {
    const e = body.errors[0];
    throw new Error(`Neo4j error${e?.code ? ` [${e.code}]` : ""}: ${e?.message ?? "unknown"}`);
  }
  if (!res.ok) {
    throw new Error(`Query API ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }

  const fields = body.data?.fields ?? [];
  const values = body.data?.values ?? [];
  const rows = values.map((row) => {
    const obj: Record<string, unknown> = {};
    fields.forEach((f, i) => {
      obj[f] = row[i];
    });
    return obj;
  });
  return body.counters ? { rows, counters: body.counters } : { rows };
}

/**
 * Build a compact schema description using only built-in introspection
 * procedures (community edition has no APOC). Two Query API round-trips:
 * node-type properties and relationship-type properties.
 */
async function getSchema(): Promise<unknown> {
  const [nodeProps, relProps] = await Promise.all([
    runCypher(
      "CALL db.schema.nodeTypeProperties() " +
        "YIELD nodeLabels, propertyName, propertyTypes " +
        "RETURN nodeLabels, propertyName, propertyTypes",
      {},
    ).catch((e) => ({ rows: [{ error: errMsg(e) }] })),
    runCypher(
      "CALL db.schema.relTypeProperties() " +
        "YIELD relType, propertyName, propertyTypes " +
        "RETURN relType, propertyName, propertyTypes",
      {},
    ).catch((e) => ({ rows: [{ error: errMsg(e) }] })),
  ]);

  // Fold the flat property rows into a per-label / per-relType map.
  const nodes: Record<string, { properties: Record<string, string[]> }> = {};
  for (const r of nodeProps.rows as Array<Record<string, unknown>>) {
    const labels = Array.isArray(r["nodeLabels"]) ? (r["nodeLabels"] as string[]) : [];
    const key = labels.join(":") || "(no label)";
    const prop = r["propertyName"];
    const types = Array.isArray(r["propertyTypes"]) ? (r["propertyTypes"] as string[]) : [];
    nodes[key] ??= { properties: {} };
    if (typeof prop === "string") nodes[key].properties[prop] = types;
  }

  const relationships: Record<string, { properties: Record<string, string[]> }> = {};
  for (const r of relProps.rows as Array<Record<string, unknown>>) {
    const rawType = typeof r["relType"] === "string" ? (r["relType"] as string) : "(unknown)";
    // db.schema.relTypeProperties returns relType wrapped like ":`KNOWS`".
    const key = rawType.replace(/^:?`?/, "").replace(/`?$/, "");
    const prop = r["propertyName"];
    const types = Array.isArray(r["propertyTypes"]) ? (r["propertyTypes"] as string[]) : [];
    relationships[key] ??= { properties: {} };
    if (typeof prop === "string") relationships[key].properties[prop] = types;
  }

  return { database: DATABASE, nodes, relationships };
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): CallToolResult {
  const msg = errMsg(err);
  logErr(`tool error: ${msg}`);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

function cypherArg(args: Record<string, unknown>): string {
  // Accept both `query` (official mcp-neo4j-cypher) and `cypher` for safety.
  const q = args["query"] ?? args["cypher"];
  if (typeof q !== "string" || !q.trim()) throw new Error("query is required (non-empty string)");
  return q;
}

function paramsArg(args: Record<string, unknown>): Record<string, unknown> {
  const p = args["params"] ?? args["parameters"];
  if (p == null) return {};
  if (typeof p !== "object" || Array.isArray(p)) throw new Error("params must be an object");
  return p as Record<string, unknown>;
}

const TOOLS: Tool[] = [
  {
    name: "get_neo4j_schema",
    description:
      "List the database schema: node labels with their property names/types and relationship types with their property names/types. Call this first to discover what's in the graph before writing cypher.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_neo4j_cypher",
    description:
      "Run a READ-ONLY cypher query against Neo4j and return the rows. Use parameters (the `params` object) instead of string-concatenating values. Mutating clauses (CREATE/MERGE/DELETE/SET/REMOVE/…) are rejected here — use write_neo4j_cypher for those.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The cypher read query to execute" },
        params: {
          type: "object",
          description: "Optional query parameters referenced as $name in the cypher",
          additionalProperties: true,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "write_neo4j_cypher",
    description:
      "Run a WRITE cypher query (CREATE/MERGE/DELETE/SET/…) against Neo4j and return update counters. Disabled when the connector is configured read-only.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The cypher write query to execute" },
        params: {
          type: "object",
          description: "Optional query parameters referenced as $name in the cypher",
          additionalProperties: true,
        },
      },
      required: ["query"],
    },
  },
];

const server = new Server(
  { name: "neo4j-http-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// Advertise only the tools the connector is allowed to use, so a read-only
// connector never even exposes the write tool to the model.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: READ_ONLY ? TOOLS.filter((t) => t.name !== "write_neo4j_cypher") : TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs = {} } = request.params;
  const args = rawArgs as Record<string, unknown>;

  try {
    switch (name) {
      case "get_neo4j_schema":
        return ok(await getSchema());

      case "read_neo4j_cypher": {
        const query = cypherArg(args);
        if (looksLikeWrite(query)) {
          throw new Error(
            "read_neo4j_cypher received a mutating query. Use write_neo4j_cypher (if the connector allows writes).",
          );
        }
        const { rows } = await runCypher(query, paramsArg(args));
        return ok(rows);
      }

      case "write_neo4j_cypher": {
        if (READ_ONLY) {
          throw new Error("This Neo4j connector is configured read-only; writes are disabled.");
        }
        const query = cypherArg(args);
        const { rows, counters } = await runCypher(query, paramsArg(args));
        return ok({ rows, counters });
      }

      default:
        return fail(new Error(`Unknown tool: ${name}`));
    }
  } catch (err) {
    return fail(err);
  }
});

logErr(`server starting → ${QUERY_URL} (db=${DATABASE}, readOnly=${READ_ONLY})`);
const transport = new StdioServerTransport();
await server.connect(transport);
logErr("server connected on stdio");
