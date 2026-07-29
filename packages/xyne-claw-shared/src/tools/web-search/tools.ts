/**
 * Web Search Tool — powered by Brave Search API
 */

import type { ToolDefinition, ToolExecutionContext } from "../types.js";

import { createLogger } from "../../logger.js";
const log = createLogger("tools");

export const WEB_SEARCH_CONFIG_SCHEMA = {
  BRAVE_SEARCH_API_KEY: {
    label: "Brave Search API Key",
    default: "",
    required: true as const,
    placeholder: "BSA...",
  },
};

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  page_age?: string;
  extra_snippets?: string[];
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] };
}

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const WEB_SEARCH_TIMEOUT_MS = 30_000;

export const webSearchTool: ToolDefinition = {
  slug: "web-search",
  name: "Web Search",
  description:
    "Perform a web search to find current information from the internet. " +
    "Use for questions about recent events, current data, or any topic requiring up-to-date information. " +
    "Returns search results with titles, URLs, and content snippets.",
  source: "custom:web-search",
  configSchema: WEB_SEARCH_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The search query to execute. Be specific for better results. " +
          "Examples: 'React 19 new features', 'current stock price of AAPL'",
      },
    },
    required: ["query"],
  },

  async execute(params, context) {
    const query = (params["query"] as string | undefined)?.trim();
    if (!query) return "Error: query is required.";

    const config = context?.config ?? {};
    const apiKey = config["BRAVE_SEARCH_API_KEY"] || process.env["BRAVE_SEARCH_API_KEY"] || "";
    if (!apiKey) return "Error: BRAVE_SEARCH_API_KEY is not configured. Web search is unavailable.";

    log.info(`[web-search] query="${query.substring(0, 80)}"`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);

      const searchUrl = new URL(BRAVE_SEARCH_URL);
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("count", "20");

      const response = await fetch(searchUrl.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401) return "Error: Authentication failed — check BRAVE_SEARCH_API_KEY";
        if (response.status === 429) return "Error: Brave Search rate limit exceeded. Try again later.";
        if (response.status >= 500) return `Error: Brave Search server error ${response.status}`;
        return `Error: Brave Search returned status ${response.status}: ${errorText}`;
      }

      const data = await response.json() as BraveResponse;
      const results = data.web?.results ?? [];

      if (results.length === 0) return "No search results found for the query.";

      const formatted = results
        .map((r, idx) => {
          const age = r.page_age ? ` (${r.page_age})` : "";
          const snippets = r.extra_snippets?.length ? "\n" + r.extra_snippets.join(" ") : "";
          return `[${idx + 1}] ${r.title}\nURL: ${r.url}${age}\n${r.description}${snippets}`;
        })
        .join("\n\n");

      return `Found ${results.length} search results:\n\n${formatted}`;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return "Error: Web search timed out after 30 seconds";
      }
      const msg = error instanceof Error ? error.message : "Unknown error";
      log.error(`[web-search] error: ${msg}`);
      return `Error performing web search: ${msg}`;
    }
  },
};
