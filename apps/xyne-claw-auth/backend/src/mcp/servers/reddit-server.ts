#!/usr/bin/env node
/**
 * Reddit — stdio MCP server (read-only, UNAUTHENTICATED).
 *
 * Uses Reddit's public `.json` endpoints (no OAuth, no account, no client
 * id/secret). Exposes exactly two tools: search_reddit and get_subreddit_posts
 * (browse). Spawned by the parent backend via `node --import tsx/esm <this-file>`;
 * see src/mcp/adapters/reddit.ts.
 *
 * CAVEATS:
 *  - Reddit rate-limits / blocks unauthenticated requests, especially from
 *    datacenter IPs (HTTP 429/403). A descriptive User-Agent + low volume help
 *    but this is best-effort. For reliable/approved access, switch to the
 *    OAuth client_credentials flow (needs a registered Reddit app).
 *  - Per Reddit's Responsible Builder Policy, API access nominally requires
 *    approval; this unauthenticated path is read-only on public data.
 *
 * Env (all optional):
 *   REDDIT_USER_AGENT — descriptive UA string Reddit asks for.
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

const USER_AGENT = process.env["REDDIT_USER_AGENT"]?.trim() || "xyne-claw-reddit-mcp/0.1 (read-only)";
const BASE = "https://www.reddit.com";
const REQUEST_TIMEOUT_MS = 30_000;

async function redditGet(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 429 || res.status === 403) {
    throw new Error(
      `Reddit ${res.status}: unauthenticated request was rate-limited/blocked. ` +
        `Reddit throttles anonymous access (esp. from server IPs). Retry later or use an approved OAuth app.`,
    );
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Reddit API ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

const TOOLS: Tool[] = [
  {
    name: "search_reddit",
    description: "Search Reddit posts (public, read-only). Optionally restrict to a subreddit.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        subreddit: { type: "string", description: "Optional subreddit name (without r/) to restrict the search." },
        sort: { type: "string", description: "relevance | hot | top | new | comments (default relevance)." },
        limit: { type: "number", description: "Number of results, 1–100 (default 10)." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_subreddit_posts",
    description: "Browse a subreddit's posts by sort order (public, read-only).",
    inputSchema: {
      type: "object",
      properties: {
        subreddit: { type: "string", description: "Subreddit name (without r/)." },
        sort: { type: "string", description: "hot | new | top | rising (default hot)." },
        time: { type: "string", description: "For sort=top: hour | day | week | month | year | all." },
        limit: { type: "number", description: "Number of posts, 1–100 (default 10)." },
      },
      required: ["subreddit"],
    },
  },
];

const server = new Server({ name: "reddit", version: "0.2.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

function clampLimit(v: unknown, def: number, max: number): number {
  return typeof v === "number" && v > 0 ? Math.min(max, Math.floor(v)) : def;
}

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "search_reddit") {
      const query = (args?.["query"] as string | undefined)?.trim();
      if (!query) throw new Error("search_reddit: `query` is required");
      const sub = (args?.["subreddit"] as string | undefined)?.trim().replace(/^r\//, "");
      const path = sub ? `/r/${encodeURIComponent(sub)}/search.json` : "/search.json";
      const result = await redditGet(path, {
        q: query,
        sort: (args?.["sort"] as string | undefined) ?? "relevance",
        limit: clampLimit(args?.["limit"], 10, 100),
        ...(sub ? { restrict_sr: "1" } : {}),
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    if (name === "get_subreddit_posts") {
      const sub = (args?.["subreddit"] as string | undefined)?.trim().replace(/^r\//, "");
      if (!sub) throw new Error("get_subreddit_posts: `subreddit` is required");
      const sort = (args?.["sort"] as string | undefined)?.trim() || "hot";
      const result = await redditGet(`/r/${encodeURIComponent(sub)}/${encodeURIComponent(sort)}.json`, {
        limit: clampLimit(args?.["limit"], 10, 100),
        ...(sort === "top" && args?.["time"] ? { t: String(args["time"]) } : {}),
      });
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
