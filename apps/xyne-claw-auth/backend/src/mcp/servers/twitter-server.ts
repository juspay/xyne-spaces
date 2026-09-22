#!/usr/bin/env node
/**
 * Twitter / X — stdio MCP server.
 *
 * In-tree replacement for the external `@enescinar/twitter-mcp` npx package, so
 * the implementation lives in this repo (code-reviewable, no runtime fetch).
 * Spawned by the parent backend via `node --import tsx/esm <this-file>` — see
 * src/mcp/adapters/twitter.ts for the launch wiring.
 *
 * Auth: OAuth 1.0a user context (HMAC-SHA1). All four keys come from the
 * Twitter Developer Portal and are injected as env vars by the adapter's
 * buildCommand from the user-pasted credentials:
 *   API_KEY, API_SECRET_KEY, ACCESS_TOKEN, ACCESS_TOKEN_SECRET
 *
 * Endpoints used (Twitter API v2):
 *   GET  /2/tweets/search/recent → search_tweets
 *
 * Read-only: only tweet search is exposed (no posting).
 */

import { createHmac, randomBytes } from "node:crypto";
import { errMsg } from "../../lib/errors.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

const API_KEY = process.env["API_KEY"];
const API_SECRET_KEY = process.env["API_SECRET_KEY"];
const ACCESS_TOKEN = process.env["ACCESS_TOKEN"];
const ACCESS_TOKEN_SECRET = process.env["ACCESS_TOKEN_SECRET"];
const REQUEST_TIMEOUT_MS = 30_000;

function logErr(msg: string): void {
  // stdout is the MCP transport; logs MUST go to stderr.
  console.error(`[twitter] ${msg}`);
}

if (!API_KEY || !API_SECRET_KEY || !ACCESS_TOKEN || !ACCESS_TOKEN_SECRET) {
  logErr("API_KEY, API_SECRET_KEY, ACCESS_TOKEN and ACCESS_TOKEN_SECRET must all be set — exiting");
  process.exit(1);
}

/** RFC-3986 percent-encoding (stricter than encodeURIComponent). */
function pe(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Build the OAuth 1.0a `Authorization` header for a request. `queryParams` must
 * include any URL query params (they are part of the signature base); a JSON
 * request body is NOT signed, per the OAuth 1.0a spec.
 */
function oauthHeader(method: "GET" | "POST", baseUrl: string, queryParams: Record<string, string>): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: API_KEY!,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: ACCESS_TOKEN!,
    oauth_version: "1.0",
  };

  const allParams = { ...queryParams, ...oauth };
  const paramString = Object.keys(allParams)
    .map((k) => [pe(k), pe(allParams[k]!)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const baseString = `${method}&${pe(baseUrl)}&${pe(paramString)}`;
  const signingKey = `${pe(API_SECRET_KEY!)}&${pe(ACCESS_TOKEN_SECRET!)}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  const header: Record<string, string> = { ...oauth, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(header)
      .sort()
      .map((k) => `${pe(k)}="${pe(header[k]!)}"`)
      .join(", ")
  );
}

async function searchTweets(query: string, count: number): Promise<unknown> {
  const baseUrl = "https://api.twitter.com/2/tweets/search/recent";
  // Twitter v2 recent search requires max_results between 10 and 100.
  const maxResults = String(Math.min(100, Math.max(10, count)));
  const queryParams: Record<string, string> = {
    query,
    max_results: maxResults,
    "tweet.fields": "created_at,author_id,public_metrics",
  };
  const url = `${baseUrl}?${Object.entries(queryParams).map(([k, v]) => `${pe(k)}=${pe(v)}`).join("&")}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: oauthHeader("GET", baseUrl, queryParams) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twitter API ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const TOOLS: Tool[] = [
  {
    name: "search_tweets",
    description: "Search recent tweets (last 7 days) matching a query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (Twitter search operators supported)." },
        count: { type: "number", description: "Number of results, 10–100 (default 10)." },
      },
      required: ["query"],
    },
  },
];

const server = new Server({ name: "twitter", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "search_tweets") {
      const query = (args?.["query"] as string | undefined)?.trim();
      if (!query) throw new Error("search_tweets: `query` is required");
      const count = typeof args?.["count"] === "number" ? (args["count"] as number) : 10;
      const result = await searchTweets(query, count);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
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
