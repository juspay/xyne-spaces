/**
 * Genius Tools
 * 
 * Query business intelligence and investigation data from the Genius engine.
 */

import type { ToolDefinition, ToolExecutionContext } from "../types.js";

const GENIUS_TIMEOUT_MS = 5 * 60 * 1000;
const GENIUS_QUERY_ROUTING_PATH = "/api/v3/query_routing/";

export const GENIUS_CONFIG_SCHEMA = {
  GENIUS_API_URL: {
    label: "Genius API URL",
    default: "",
    required: true as const,
    placeholder: "https://genius.juspay.in",
  },
  QUERY_ROUTING_KEY: {
    label: "Query Routing Key",
    default: "",
    required: true as const,
    placeholder: "Basic <base64_credentials>",
  },
};

function resolveGeniusConfig(context: ToolExecutionContext | undefined): { url: string; apiKey: string } | string {
  const config = context?.config ?? {};
  const baseUrl = config["GENIUS_API_URL"] || process.env["GENIUS_API_URL"] || "";
  const apiKey = config["QUERY_ROUTING_KEY"] || process.env["QUERY_ROUTING_KEY"] || "";

  if (!baseUrl) return "Error: GENIUS_API_URL is not configured.";
  if (!apiKey) return "Error: QUERY_ROUTING_KEY is not configured.";

  const url = baseUrl.replace(/\/$/, "") + GENIUS_QUERY_ROUTING_PATH;
  return { url, apiKey };
}

async function executeGeniusQuery(
  query: string,
  agent: string,
  context: ToolExecutionContext | undefined
): Promise<string> {
  const config = resolveGeniusConfig(context);
  if (typeof config === "string") return config;

  const { url, apiKey } = config;
  const userId = context?.meta?.["userId"] || "unknown";
  const userEmail = context?.meta?.["userEmail"] || "";

  console.log(`[genius-${agent}] query="${query.substring(0, 80)}...", user=${userId}, ${userEmail}`);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: apiKey,
    Accept: "text/event-stream",
    "X-Xyne-User-Id": userId,
  };

  const requestBody = JSON.stringify({
    query,
    agent,
    source: "xyne_spaces",
    email: userEmail,
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GENIUS_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: requestBody,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      return `Error: Genius API returned status ${response.status}: ${errorText}`;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return "Error: No response body from Genius API";
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult = "";
    let currentEventType = "";
    let apiError = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEventType = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          const dataContent = line.slice(5).trim();
          if (!dataContent) continue;

          try {
            const eventData = JSON.parse(dataContent);
            
            if (currentEventType === "error" && eventData.error) {
              apiError = eventData.error;
              continue;
            }
            
            const isFinalOutput = 
              currentEventType === "final_output" ||
              (currentEventType === undefined && 
               "message" in eventData && 
               "responses" in eventData && 
               "session_id" in eventData);
            
            if (isFinalOutput && eventData.message) {
              finalResult = eventData.message;
            }
          } catch {
            // Non-JSON SSE data, skip
          }
        }
      }
    }

    if (apiError) {
      return `Genius API Error: ${apiError}`;
    }

    console.log(`[genius-${agent}] completed, result length=${finalResult.length}`);
    return finalResult || "Genius query completed but no result was returned.";

  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      return "Error: Genius API request timed out after 5 minutes";
    }

    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[genius-${agent}] error: ${msg}`);
    return `Error calling Genius API: ${msg}`;
  }
}

function createGeniusTool(type: "analytics" | "investigation"): ToolDefinition {
  const isAnalytics = type === "analytics";
  const name = isAnalytics ? "Genius Analytics" : "Genius Investigation";
  const slug = isAnalytics ? "genius-analytics" : "genius-investigation";
  const source = isAnalytics ? "custom:genius-analytics" : "custom:genius-investigation";
  
  const description = isAnalytics
    ? "Query business intelligence, analytics, and metrics from the Genius Analytics engine. " +
      "Use for GMV, revenue, transaction trends, payment success rates, merchant performance, KPIs, " +
      "and any business data questions. " +
      "Example: 'What was our GMV last month?' or 'Show me failed transaction trends this week'"
    : "AI-powered deep investigation assistant for root cause analysis of complex incidents. " +
      "Use for investigating transactions, fraud cases, disputes, security incidents, and any complex issues requiring thorough analysis. " +
      "Example: 'Investigate why TXN12345 failed' or 'Root cause analysis for the payment outage yesterday'";

  const queryDescription = isAnalytics
    ? "Natural language analytics query. Be specific: time period, metrics needed, filters (merchant, product, etc.). " +
      "Examples: 'GMV for last quarter', 'payment success rate by merchant', 'transaction volume trends'"
    : "Natural language investigation query. Be specific: transaction IDs, time period, case types, fraud indicators, etc. " +
      "Examples: 'Investigate transaction TXN123', 'Show fraud cases from this month', 'Transaction anomaly analysis'";

  return {
    slug,
    name,
    description,
    source,
    configSchema: GENIUS_CONFIG_SCHEMA,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: queryDescription,
        },
      },
      required: ["query"],
    },

    async execute(params, context) {
      const query = (params["query"] as string | undefined)?.trim();
      if (!query) return "Error: query is required.";
      return executeGeniusQuery(query, type, context);
    },
  };
}

export const geniusAnalyticsTool: ToolDefinition = createGeniusTool("analytics");
export const geniusInvestigationTool: ToolDefinition = createGeniusTool("investigation");
