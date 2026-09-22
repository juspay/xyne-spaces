#!/usr/bin/env node
/**
 * X (Twitter) news — stdio MCP server, READ-ONLY, via a third-party data API.
 *
 * Reads public X posts through TwitterAPI.io (https://twitterapi.io) — a
 * third-party service that scrapes X on its own infra and exposes a REST API.
 * This needs NO X account, NO X developer app, and is pay-per-use (~$0.15 per
 * 1,000 tweets). Only the TwitterAPI.io key is required.
 *
 * Spawned via `node --import tsx/esm <this-file>`; see src/mcp/adapters/x-news.ts.
 *
 * Tools:
 *   get_user_tweets  → GET /twitter/user/last_tweets   (scrape one handle)
 *   search_tweets    → GET /twitter/tweet/advanced_search
 *
 * Env: TWITTERAPI_IO_KEY (required) — your TwitterAPI.io API key.
 *
 * NOTE: this is third-party scraping of X (ToS gray area) and reliability
 * depends on the vendor. It exists so an AI-news agent can read specific
 * curated AI accounts without an X account or the paid official API.
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

const API_KEY = process.env["TWITTERAPI_IO_KEY"];
const BASE = "https://api.twitterapi.io";
const REQUEST_TIMEOUT_MS = 30_000;

function logErr(msg: string): void {
  console.error(`[x-news] ${msg}`);
}

if (!API_KEY) {
  logErr("TWITTERAPI_IO_KEY must be set — exiting");
  process.exit(1);
}

interface RawTweet {
  id?: string;
  text?: string;
  url?: string;
  createdAt?: string;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  quoteCount?: number;
  viewCount?: number;
  author?: { userName?: string; name?: string };
}

async function apiGet(path: string, params: Record<string, string | undefined>): Promise<Record<string, unknown>> {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: { "X-API-Key": API_KEY!, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`TwitterAPI.io ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

// The API has shipped both top-level `tweets` and nested `data.tweets`; handle both.
function extractTweets(json: Record<string, unknown>): RawTweet[] {
  if (Array.isArray(json["tweets"])) return json["tweets"] as RawTweet[];
  const data = json["data"];
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>)["tweets"])) {
    return (data as Record<string, unknown>)["tweets"] as RawTweet[];
  }
  if (Array.isArray(data)) return data as RawTweet[];
  return [];
}

function slim(t: RawTweet, fallbackHandle?: string) {
  return {
    id: t.id,
    text: t.text,
    url: t.url ?? (t.id ? `https://x.com/${t.author?.userName ?? fallbackHandle ?? "i"}/status/${t.id}` : undefined),
    author: t.author?.userName ?? fallbackHandle,
    createdAt: t.createdAt,
    likes: t.likeCount ?? 0,
    retweets: t.retweetCount ?? 0,
    views: t.viewCount ?? 0,
  };
}

function clamp(v: unknown, def: number, max: number): number {
  return typeof v === "number" && v > 0 ? Math.min(max, Math.floor(v)) : def;
}

const TOOLS: Tool[] = [
  {
    name: "get_user_tweets",
    description:
      "Get a specific X/Twitter account's recent posts by handle (read-only). Use for curated AI-news accounts. " +
      "Returns text, url, time and engagement counts.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string", description: "X handle without the @ (e.g. 'karpathy')." },
        count: { type: "number", description: "Max tweets to return, 1–50 (default 20)." },
        includeReplies: { type: "boolean", description: "Include replies (default false)." },
      },
      required: ["username"],
    },
  },
  {
    name: "search_tweets",
    description: "Search recent public X/Twitter posts matching a query (read-only).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (X search operators supported)." },
        count: { type: "number", description: "Max results, 1–50 (default 20)." },
      },
      required: ["query"],
    },
  },
];

const server = new Server({ name: "x-news", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "get_user_tweets") {
      const username = (args?.["username"] as string | undefined)?.trim().replace(/^@/, "");
      if (!username) throw new Error("get_user_tweets: `username` is required");
      const count = clamp(args?.["count"], 20, 50);
      const json = await apiGet("/twitter/user/last_tweets", {
        userName: username,
        includeReplies: args?.["includeReplies"] === true ? "true" : "false",
      });
      const tweets = extractTweets(json).slice(0, count).map((t) => slim(t, username));
      return { content: [{ type: "text", text: JSON.stringify({ username, count: tweets.length, tweets }) }] };
    }
    if (name === "search_tweets") {
      const query = (args?.["query"] as string | undefined)?.trim();
      if (!query) throw new Error("search_tweets: `query` is required");
      const count = clamp(args?.["count"], 20, 50);
      const json = await apiGet("/twitter/tweet/advanced_search", { query, queryType: "Latest" });
      const tweets = extractTweets(json).slice(0, count).map((t) => slim(t));
      return { content: [{ type: "text", text: JSON.stringify({ query, count: tweets.length, tweets }) }] };
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
