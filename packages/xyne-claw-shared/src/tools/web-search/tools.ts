/**
 * Web Search Tool — powered by the Parallel Search API (https://docs.parallel.ai)
 */

import type { ToolDefinition } from "../types.js";

import { createLogger } from "../../logger.js";
const log = createLogger("tools");

export const WEB_SEARCH_CONFIG_SCHEMA = {
  PARALLEL_API_KEY: {
    label: "Parallel API Key",
    default: "",
    required: true as const,
    placeholder: "par-...",
  },
};

interface ParallelSearchResult {
  url: string;
  title?: string | null;
  publish_date?: string | null;
  excerpts?: string[] | null;
}

interface ParallelSearchResponse {
  search_id?: string;
  results?: ParallelSearchResult[];
}

const PARALLEL_SEARCH_URL = "https://api.parallel.ai/v1/search";
const WEB_SEARCH_TIMEOUT_MS = 30_000;
const MAX_RESULTS = 10;
const MAX_CHARS_PER_RESULT = 1_500;
const MAX_QUERIES = 5;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 3_000;
const ERROR_BODY_PREVIEW = 300;

function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  const seconds = header ? Number(header) : Number.NaN;
  const hinted = Number.isFinite(seconds) ? seconds * 1000 : 500 * 2 ** attempt;
  return Math.min(Math.max(hinted, 0), MAX_RETRY_DELAY_MS);
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectQueries(params: Record<string, unknown>): string[] {
  const primary = typeof params["query"] === "string" ? params["query"].trim() : "";
  const extra = Array.isArray(params["queries"])
    ? params["queries"].filter((q): q is string => typeof q === "string").map((q) => q.trim())
    : [];
  return [...new Set([primary, ...extra].filter((q) => q.length > 0))].slice(0, MAX_QUERIES);
}

export const webSearchTool: ToolDefinition = {
  slug: "web-search",
  name: "Web Search",
  description:
    "Perform a web search to find current information from the internet. " +
    "Use for questions about recent events, current data, or any topic requiring up-to-date information. " +
    "Returns ranked results with titles, URLs, publish dates and relevant excerpts from each page. " +
    "Pass `objective` to describe what you are trying to learn — it steers which excerpts are extracted.",
  source: "custom:web-search",
  configSchema: WEB_SEARCH_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "A concise keyword search query, 3-6 words. " +
          "Examples: 'React 19 new features', 'AAPL stock price today'",
      },
      queries: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional additional keyword queries run in the same search (2-3 total works best), " +
          "e.g. different phrasings of the same question.",
      },
      objective: {
        type: "string",
        description:
          "Optional natural-language description of the question you are trying to answer. " +
          "Used to pick the most relevant excerpts from each result.",
      },
    },
    required: ["query"],
  },

  async execute(params, context) {
    const searchQueries = collectQueries(params);
    if (searchQueries.length === 0) return "Error: query is required.";
    const objective = typeof params["objective"] === "string" ? params["objective"].trim() : "";

    const config = context?.config ?? {};
    const apiKey = config["PARALLEL_API_KEY"] || process.env["PARALLEL_API_KEY"] || "";
    if (!apiKey) return "Error: PARALLEL_API_KEY is not configured. Web search is unavailable.";

    log.info(`[web-search] queries=${JSON.stringify(searchQueries).substring(0, 160)}`);

    const body = JSON.stringify({
      search_queries: searchQueries,
      ...(objective ? { objective } : {}),
      mode: "fast",
      advanced_settings: {
        max_results: MAX_RESULTS,
        excerpt_settings: { max_chars_per_result: MAX_CHARS_PER_RESULT },
      },
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);
    try {
      let response: Response | undefined;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        response = await fetch(PARALLEL_SEARCH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "x-api-key": apiKey,
          },
          body,
          signal: controller.signal,
        });
        if (response.ok || !isRetryable(response.status) || attempt === MAX_ATTEMPTS - 1) break;
        const delay = retryDelayMs(response, attempt);
        log.warn(`[web-search] Parallel returned ${response.status}; retry ${attempt + 1}/${MAX_ATTEMPTS - 1} in ${delay}ms`);
        await response.body?.cancel().catch(() => {});
        await sleep(delay);
      }
      if (!response) return "Error: web search did not run.";

      if (!response.ok) {
        const errorText = (await response.text().catch(() => "")).slice(0, ERROR_BODY_PREVIEW);
        log.warn(`[web-search] Parallel search failed status=${response.status} body=${errorText}`);
        if (response.status === 401 || response.status === 403) return "Error: Authentication failed — check PARALLEL_API_KEY";
        if (response.status === 429) return "Error: Parallel Search rate limit exceeded after retries. Try again shortly.";
        if (response.status === 422) return `Error: Parallel Search rejected the request: ${errorText}`;
        if (response.status >= 500) return `Error: Parallel Search server error ${response.status}`;
        return `Error: Parallel Search returned status ${response.status}: ${errorText}`;
      }

      const data = (await response.json()) as ParallelSearchResponse;
      const results = data.results ?? [];
      if (results.length === 0) return "No search results found for the query.";

      const formatted = results
        .map((r, idx) => {
          const date = r.publish_date ? ` (${r.publish_date})` : "";
          const excerpts = (r.excerpts ?? []).filter((e) => e.trim().length > 0).join("\n…\n");
          return `[${idx + 1}] ${r.title ?? r.url}\nURL: ${r.url}${date}${excerpts ? `\n${excerpts}` : ""}`;
        })
        .join("\n\n");

      return `Found ${results.length} search results:\n\n${formatted}`;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return `Error: Web search timed out after ${WEB_SEARCH_TIMEOUT_MS / 1000} seconds`;
      }
      const msg = error instanceof Error ? error.message : "Unknown error";
      log.error(`[web-search] error: ${msg}`);
      return `Error performing web search: ${msg}`;
    } finally {
      clearTimeout(timeoutId);
    }
  },
};
