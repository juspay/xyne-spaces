/**
 * Genius Analytics Tool
 * 
 * Query business intelligence, metrics, GMV, revenue, trends, and KPIs
 * from the Genius Analytics engine.
 */

import https from "node:https";
import type { ToolDefinition, ToolExecutionContext } from "../types.js";

// ─── HTTP helper ─────────────────────────────────────────────────────────────

/** POST JSON using native https — bypasses undici/fetch HTTP/2 GOAWAY issues. */
function httpsPost(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Shared constants ────────────────────────────────────────────────────────

const GENIUS_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export const GENIUS_CONFIG_SCHEMA = {
  GENIUS_API_URL: {
    label: "Genius API URL",
    default: "",
    required: true as const,
    placeholder: "https://genius.internal/api/v3/query_routing/",
  },
  GENIUS_API_KEY: {
    label: "Genius API Key",
    default: "",
    required: true as const,
    placeholder: "routing-key-...",
  },
};

// ─── Internal helpers ────────────────────────────────────────────────────────

function resolveGeniusConfig(context: ToolExecutionContext | undefined): { url: string; apiKey: string } | string {
  const config = context?.config ?? {};
  
  const url = config["GENIUS_API_URL"] || process.env["GENIUS_API_URL"] || "";
  const apiKey = config["GENIUS_API_KEY"] || process.env["GENIUS_API_KEY"] || "";

  if (!url) return "Error: GENIUS_API_URL is not configured.";
  if (!apiKey) return "Error: GENIUS_API_KEY is not configured.";

  return { url, apiKey };
}

function getISTTimestamp(): string {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString();
}

// ─── genius tool ─────────────────────────────────────────────────────────────

export const geniusTool: ToolDefinition = {
  slug: "genius",
  name: "Genius Analytics",
  description:
    "Query business intelligence, analytics, and metrics from the Genius Analytics engine. " +
    "Use for GMV, revenue, transaction trends, payment success rates, merchant performance, KPIs, " +
    "and any business data questions. " +
    "Example: 'What was our GMV last month?' or 'Show me failed transaction trends this week'",
  source: "custom:genius",
  configSchema: GENIUS_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Natural language analytics query. Be specific: time period, metrics needed, filters (merchant, product, etc.). " +
          "Examples: 'GMV for last quarter', 'payment success rate by merchant', 'transaction volume trends'",
      },
    },
    required: ["query"],
  },

  async execute(params, context) {
    const query = (params["query"] as string | undefined)?.trim();
    
    if (!query) return "Error: query is required.";

    const config = resolveGeniusConfig(context);
    if (typeof config === "string") return config;

    const { url, apiKey } = config;
    const currentTimestamp = getISTTimestamp();
    
    // Get user info from context if available
    const userId = context?.meta?.["userId"] || "unknown";
    const userEmail = context?.meta?.["userEmail"] || "";

    console.log(`[genius] query="${query.substring(0, 80)}...", user=${userId}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GENIUS_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey,
          Accept: "text/event-stream",
          "X-Xyne-User-Id": userId,
        },
        body: JSON.stringify({
          query,
          current_timestamp: currentTimestamp,
          agent: "analytics",
          source: "xyne_claw",
          email: userEmail,
        }),
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data:")) {
            const dataContent = line.slice(5).trim();
            if (!dataContent) continue;

            try {
              const eventData = JSON.parse(dataContent);
              if (eventData.type === "final_output" && eventData.message) {
                finalResult = eventData.message;
              }
            } catch {
              // Non-JSON SSE data, skip
            }
          }
        }
      }

      console.log(`[genius] completed, result length=${finalResult.length}`);
      return finalResult || "Genius query completed but no result was returned.";

    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        return "Error: Genius API request timed out after 5 minutes";
      }

      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[genius] error: ${msg}`);
      return `Error calling Genius API: ${msg}`;
    }
  },
};