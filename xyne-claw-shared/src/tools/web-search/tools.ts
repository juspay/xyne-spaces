/**
 * Web Search Tool
 *
 * Perform a web search to find current information from the internet.
 * Uses the Xyne AI Extended websearch API.
 */

import type { ToolDefinition, ToolExecutionContext } from "../types.js";

export const WEB_SEARCH_CONFIG_SCHEMA = {
  XYNE_AI_EXTENDED_URL: {
    label: "Xyne AI Extended URL",
    default: "",
    required: true as const,
    placeholder: "https://xyne-ai-extended.internal",
  },
  XYNE_AI_EXTENDED_API_KEY: {
    label: "Xyne AI Extended API Key",
    default: "",
    required: false as const,
  },
};

interface SearchResult {
  url: string;
  title: string;
  content: string;
  engine: string;
  score: number;
  publishedDate: string | null;
}

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

    const configResult = resolveConfig(context);
    if (typeof configResult === "string") return configResult;
    const { url, apiKey } = configResult;

    console.log(`[web-search] query="${query.substring(0, 80)}..."`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);

      const baseUrl = url.replace(/\/$/, "");
      const searchUrl = new URL(`${baseUrl}/search`);
      searchUrl.searchParams.append("q", query);
      searchUrl.searchParams.append("format", "json");

      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "JAF-WebSearch-Tool/1.0",
      };
      if (apiKey) {
        headers["X-API-Key"] = apiKey;
      }

      const response = await fetch(searchUrl.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401) return "Error: Authentication failed: Invalid API key";
        if (response.status === 403) return "Error: Access forbidden: Insufficient permissions";
        if (response.status === 429) return "Error: Rate limited. Please try again later.";
        if (response.status === 404) return `Error: Search endpoint not found at ${baseUrl}`;
        if (response.status >= 500) return `Error: Server error: ${response.status} ${response.statusText}`;
        return `Error: Web search API returned status ${response.status}: ${errorText}`;
      }

      const rawData = await response.json() as { results?: SearchResult[] };

      const results: SearchResult[] = [];
      if (Array.isArray(rawData.results)) {
        for (const r of rawData.results) {
          if (r.url && r.title) {
            results.push({
              url: r.url,
              title: r.title,
              content: r.content ?? "",
              engine: r.engine ?? "unknown",
              score: typeof r.score === "number" ? r.score : 0,
              publishedDate: r.publishedDate ?? null,
            });
          }
        }
      }

      if (results.length === 0) {
        return "No search results found for the query.";
      }

      const formattedResults = results
        .slice(0, 30)
        .map((r, idx) => {
          const publishedDate = r.publishedDate ? ` (Published: ${r.publishedDate})` : "";
          return `[${idx + 1}] ${r.title || "Untitled"}\nURL: ${r.url}\nSource: ${r.engine || "unknown"}${publishedDate}\n${r.content}`;
        })
        .join("\n\n");

      return `Found ${results.length} search results:\n\n${formattedResults}`;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return "Error: Web search timed out after 30 seconds";
      }
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[web-search] error: ${msg}`);
      return `Error performing web search: ${msg}`;
    }
  },
};

function resolveConfig(context: ToolExecutionContext | undefined): { url: string; apiKey: string } | string {
  const config = context?.config ?? {};
  const url = config["XYNE_AI_EXTENDED_URL"] || process.env["XYNE_AI_EXTENDED_URL"] || "";
  const apiKey = config["XYNE_AI_EXTENDED_API_KEY"] || process.env["XYNE_AI_EXTENDED_API_KEY"] || "";
  if (!url) return "Error: XYNE_AI_EXTENDED_URL is not configured. Web search is unavailable.";
  return { url, apiKey };
}
