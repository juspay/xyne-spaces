#!/usr/bin/env node
/**
 * LinkedIn Fresh Profile Data — stdio MCP server.
 *
 * Wraps the RapidAPI "Fresh LinkedIn Profile Data" REST API as MCP tools.
 * Spawned by the parent backend via `node --import tsx/esm <this-file>` —
 * see src/mcp/adapters/rapidapi-linkedin.ts for the launch wiring.
 *
 * Auth: parent passes the X-RapidAPI-Key via the RAPIDAPI_KEY env var
 *       (set in the adapter's buildCommand from the user-pasted creds).
 *
 * Endpoints used:
 *   GET  /get-linkedin-profile               → linkedin_get_profile
 *   GET  /get-company-by-linkedinurl         → linkedin_get_company
 *   GET  /search-employees                   → linkedin_search_employees
 *   GET  /get-profile-posts                  → linkedin_get_profile_posts
 *   GET  /search-people                      → linkedin_search_people
 *   GET  /get-profile-connections            → linkedin_get_profile_connections
 *   POST /search-employees                   → linkedin_search_employees_advanced
 *   POST /big-search-employee                → linkedin_big_search_employee
 *   POST /search-employees-by-sales-nav-url  → linkedin_search_by_sales_nav_url
 *   GET  /check-search-status                → linkedin_check_search_status
 *   GET  /get-search-results                 → linkedin_get_search_results
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

const RAPIDAPI_HOST = "fresh-linkedin-profile-data.p.rapidapi.com";
const BASE_URL = `https://${RAPIDAPI_HOST}`;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_429_MAX = 1;
const RETRY_429_BASE_DELAY_MS = 2_000;

const RAPIDAPI_KEY = process.env["RAPIDAPI_KEY"];

function logErr(msg: string): void {
  // stdout is the MCP transport; logs MUST go to stderr.
  console.error(`[linkedin-rapidapi] ${msg}`);
}

if (!RAPIDAPI_KEY) {
  logErr("RAPIDAPI_KEY env var is required — exiting");
  process.exit(1);
}

type QueryParams = Record<string, string | number | boolean | undefined | null>;
type PostBody = Record<string, unknown>;

interface RawApiArgs {
  current_company_ids?: number[];
  title_keywords?: string[];
  title_keywords_exclude?: string[];
  functions?: string[];
  geo_codes?: number[];
  geo_codes_exclude?: number[];
  past_company_ids?: number[];
  keywords?: string;
  limit?: number;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function rapidFetch(
  url: string,
  init: { method: "GET" | "POST"; body?: string },
): Promise<unknown> {
  const headers: Record<string, string> = {
    "x-rapidapi-key": RAPIDAPI_KEY!,
    "x-rapidapi-host": RAPIDAPI_HOST,
    Accept: "application/json",
  };
  if (init.method === "POST") headers["Content-Type"] = "application/json";

  let attempt = 0;
  while (true) {
    const res = await fetch(url, {
      method: init.method,
      headers,
      ...(init.body ? { body: init.body } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // 429 retry with simple linear backoff. RapidAPI's free/cheap tiers
    // throttle aggressively — a single 429 shouldn't fail the agent's tool
    // call if a short retry can recover.
    if (res.status === 429 && attempt < RETRY_429_MAX) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 10_000)
        : RETRY_429_BASE_DELAY_MS * (attempt + 1);
      logErr(`429 on ${url} — retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_429_MAX})`);
      await sleep(delay);
      attempt++;
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`RapidAPI ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
    }

    // RapidAPI sometimes returns 200 with HTML (captcha / CDN error page).
    // Guard against res.json() throwing so the agent sees a useful message.
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        `RapidAPI ${res.status} returned non-JSON (first 200 chars): ${text.slice(0, 200)}`,
      );
    }
  }
}

async function apiGet(path: string, params: QueryParams = {}): Promise<unknown> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }
  return rapidFetch(url.toString(), { method: "GET" });
}

async function apiPost(path: string, body: PostBody = {}): Promise<unknown> {
  return rapidFetch(`${BASE_URL}${path}`, { method: "POST", body: JSON.stringify(body) });
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): CallToolResult {
  const msg = errMsg(err);
  logErr(`tool error: ${msg}`);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

/**
 * Shared body-builder for the two POST employee-search tools. Returns only
 * non-empty fields so we don't send `[]` or empty strings to RapidAPI. The
 * caller decides whether to always set `limit` (advanced) or only when
 * provided (big-search).
 */
function buildEmployeeSearchBody(
  args: RawApiArgs,
  limitMode: "always" | "if-provided",
): PostBody {
  const body: PostBody = {};
  if (args.current_company_ids?.length) body["current_company_ids"] = args.current_company_ids;
  if (args.title_keywords?.length) body["title_keywords"] = args.title_keywords;
  if (args.title_keywords_exclude?.length) body["title_keywords_exclude"] = args.title_keywords_exclude;
  if (args.functions?.length) body["functions"] = args.functions;
  if (args.geo_codes?.length) body["geo_codes"] = args.geo_codes;
  if (args.geo_codes_exclude?.length) body["geo_codes_exclude"] = args.geo_codes_exclude;
  if (args.past_company_ids?.length) body["past_company_ids"] = args.past_company_ids;
  if (args.keywords) body["keywords"] = args.keywords;
  if (limitMode === "always") {
    body["limit"] = args.limit ?? 25;
  } else if (args.limit !== undefined) {
    body["limit"] = args.limit;
  }
  return body;
}

const TOOLS: Tool[] = [
  {
    name: "linkedin_get_profile",
    description: "Get a LinkedIn person profile by their LinkedIn profile URL",
    inputSchema: {
      type: "object",
      properties: {
        linkedin_url: {
          type: "string",
          description: "Full LinkedIn profile URL, e.g. https://www.linkedin.com/in/williamhgates",
        },
      },
      required: ["linkedin_url"],
    },
  },
  {
    name: "linkedin_get_company",
    description: "Get a LinkedIn company profile by the company LinkedIn URL",
    inputSchema: {
      type: "object",
      properties: {
        linkedin_url: {
          type: "string",
          description: "Full LinkedIn company URL, e.g. https://www.linkedin.com/company/microsoft",
        },
      },
      required: ["linkedin_url"],
    },
  },
  {
    name: "linkedin_search_employees",
    description: "Search for employees at a company on LinkedIn by company name",
    inputSchema: {
      type: "object",
      properties: {
        company_name: { type: "string", description: "Company name as it appears on LinkedIn" },
        keyword: { type: "string", description: "Optional keyword filter (e.g. job title or skill)" },
        page: { type: "number", description: "Page number, 1-indexed (default: 1)", default: 1 },
      },
      required: ["company_name"],
    },
  },
  {
    name: "linkedin_get_profile_posts",
    description: "Get recent posts published by a LinkedIn person",
    inputSchema: {
      type: "object",
      properties: {
        linkedin_url: { type: "string", description: "Full LinkedIn profile URL" },
        page: { type: "number", description: "Page number, 1-indexed (default: 1)", default: 1 },
      },
      required: ["linkedin_url"],
    },
  },
  {
    name: "linkedin_search_people",
    description: "Search for people on LinkedIn by keyword and optional location",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: 'Search keyword, e.g. "software engineer AI"' },
        location: { type: "string", description: 'Optional location filter, e.g. "San Francisco"' },
        page: { type: "number", description: "Page number, 1-indexed (default: 1)", default: 1 },
      },
      required: ["keyword"],
    },
  },
  {
    name: "linkedin_get_profile_connections",
    description: "Get connections or followers of a LinkedIn profile",
    inputSchema: {
      type: "object",
      properties: {
        linkedin_url: { type: "string", description: "Full LinkedIn profile URL" },
        page: { type: "number", description: "Page number, 1-indexed (default: 1)", default: 1 },
      },
      required: ["linkedin_url"],
    },
  },
  {
    name: "linkedin_search_employees_advanced",
    description:
      "Advanced employee search using POST body filters: company IDs, title keywords, functions, geo codes, exclusions, past companies, freetext keywords, and result limit. May return an async request_id — poll with linkedin_check_search_status then retrieve with linkedin_get_search_results.",
    inputSchema: {
      type: "object",
      properties: {
        current_company_ids: { type: "array", items: { type: "number" }, description: "LinkedIn numeric company IDs to filter by current employer" },
        title_keywords: { type: "array", items: { type: "string" }, description: 'Job title keywords to include, e.g. ["Director","VP","Manager"]' },
        title_keywords_exclude: { type: "array", items: { type: "string" }, description: 'Job title keywords to exclude, e.g. ["Sales","Intern"]' },
        functions: { type: "array", items: { type: "string" }, description: 'LinkedIn job function names, e.g. ["Engineering","Business Development"]' },
        geo_codes: { type: "array", items: { type: "number" }, description: "LinkedIn geo/region IDs to include (e.g. 103644278 = United States)" },
        geo_codes_exclude: { type: "array", items: { type: "number" }, description: "LinkedIn geo/region IDs to exclude" },
        past_company_ids: { type: "array", items: { type: "number" }, description: "LinkedIn company IDs to filter by past employer" },
        keywords: { type: "string", description: "Free-text keyword search across the profile" },
        limit: { type: "number", description: "Maximum number of results to return (default: 25)", default: 25 },
      },
      required: [],
    },
  },
  {
    name: "linkedin_big_search_employee",
    description:
      "Large-scale async employee search using POST body filters (company IDs, title keywords, etc.). Always returns a request_id — poll with linkedin_check_search_status then retrieve pages with linkedin_get_search_results.",
    inputSchema: {
      type: "object",
      properties: {
        current_company_ids: { type: "array", items: { type: "number" }, description: "LinkedIn numeric company IDs to filter by current employer" },
        title_keywords: { type: "array", items: { type: "string" }, description: 'Job title keywords to include, e.g. ["Director","VP"]' },
        title_keywords_exclude: { type: "array", items: { type: "string" }, description: "Job title keywords to exclude" },
        functions: { type: "array", items: { type: "string" }, description: "LinkedIn job function names" },
        geo_codes: { type: "array", items: { type: "number" }, description: "LinkedIn geo/region IDs to include" },
        geo_codes_exclude: { type: "array", items: { type: "number" }, description: "LinkedIn geo/region IDs to exclude" },
        past_company_ids: { type: "array", items: { type: "number" }, description: "LinkedIn company IDs to filter by past employer" },
        keywords: { type: "string", description: "Free-text keyword search" },
        limit: { type: "number", description: "Maximum results to return", default: 25 },
      },
      required: [],
    },
  },
  {
    name: "linkedin_search_by_sales_nav_url",
    description:
      "Search LinkedIn employees using a Sales Navigator search URL. Returns a request_id — poll with linkedin_check_search_status then retrieve pages with linkedin_get_search_results.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full LinkedIn Sales Navigator people-search URL" },
        limit: { type: "number", description: "Maximum number of results to return (default: 25)", default: 25 },
      },
      required: ["url"],
    },
  },
  {
    name: "linkedin_check_search_status",
    description:
      "Check the status of an async LinkedIn search request. Returns status (e.g. 'completed', 'processing') and total result count once done.",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "The request_id returned by an async search tool" },
      },
      required: ["request_id"],
    },
  },
  {
    name: "linkedin_get_search_results",
    description:
      "Retrieve a page of results from a completed async LinkedIn search. Call linkedin_check_search_status first to confirm the search is done.",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "The request_id returned by an async search tool" },
        page: { type: "number", description: "Page number, 1-indexed (default: 1)", default: 1 },
      },
      required: ["request_id"],
    },
  },
];

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string") throw new Error(`${key} is required (string)`);
  return v;
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

function optNum(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === "number" ? v : undefined;
}

const server = new Server(
  { name: "linkedin-rapidapi-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs = {} } = request.params;
  const args = rawArgs as Record<string, unknown>;

  try {
    switch (name) {
      case "linkedin_get_profile":
        return ok(await apiGet("/get-linkedin-profile", { linkedin_url: str(args, "linkedin_url") }));

      case "linkedin_get_company":
        return ok(await apiGet("/get-company-by-linkedinurl", { linkedin_url: str(args, "linkedin_url") }));

      case "linkedin_search_employees":
        return ok(await apiGet("/search-employees", {
          company_name: str(args, "company_name"),
          keyword: optStr(args, "keyword"),
          page: optNum(args, "page") ?? 1,
        }));

      case "linkedin_get_profile_posts":
        return ok(await apiGet("/get-profile-posts", {
          linkedin_url: str(args, "linkedin_url"),
          page: optNum(args, "page") ?? 1,
        }));

      case "linkedin_search_people":
        return ok(await apiGet("/search-people", {
          keyword: str(args, "keyword"),
          location: optStr(args, "location"),
          page: optNum(args, "page") ?? 1,
        }));

      case "linkedin_get_profile_connections":
        return ok(await apiGet("/get-profile-connections", {
          linkedin_url: str(args, "linkedin_url"),
          page: optNum(args, "page") ?? 1,
        }));

      case "linkedin_search_employees_advanced":
        return ok(await apiPost("/search-employees", buildEmployeeSearchBody(args as RawApiArgs, "always")));

      case "linkedin_big_search_employee":
        return ok(await apiPost("/big-search-employee", buildEmployeeSearchBody(args as RawApiArgs, "if-provided")));

      case "linkedin_search_by_sales_nav_url":
        return ok(await apiPost("/search-employees-by-sales-nav-url", {
          url: str(args, "url"),
          limit: optNum(args, "limit") ?? 25,
        }));

      case "linkedin_check_search_status":
        return ok(await apiGet("/check-search-status", { request_id: str(args, "request_id") }));

      case "linkedin_get_search_results":
        return ok(await apiGet("/get-search-results", {
          request_id: str(args, "request_id"),
          page: optNum(args, "page") ?? 1,
        }));

      default:
        return fail(new Error(`Unknown tool: ${name}`));
    }
  } catch (err) {
    return fail(err);
  }
});

logErr("server starting");
const transport = new StdioServerTransport();
await server.connect(transport);
logErr("server connected on stdio");
