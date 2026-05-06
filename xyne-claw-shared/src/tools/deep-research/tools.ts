/**
 * Deep Research Tool
 *
 * Performs comprehensive multi-step deep research on a topic: generates sub-queries,
 * runs parallel web searches, synthesizes a report, and saves it to a canvas.
 * Uses the Xyne AI Extended deep research API.
 */

import type { ToolDefinition, ToolExecutionContext } from "../types.js";

export const DEEP_RESEARCH_CONFIG_SCHEMA = {
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

const RESEARCH_CONFIG = {
  max_concurrent_research_units: 1,
  max_researcher_iterations: 1,
  max_react_tool_calls: 2,
  allow_clarification: false,
};

const NODE_PROGRESS: Record<string, string> = {
  clarify_with_user: "Clarifying research scope…",
  write_research_brief: "Writing research brief…",
  research_supervisor: "Planning research tasks…",
  supervisor: "Delegating to research agents…",
  researcher: "Researching web sources…",
  compress_research: "Compressing research notes…",
  final_report_generation: "Writing final report…",
};

const DEEP_RESEARCH_TIMEOUT_MS = 10 * 60 * 1000;

export const deepResearchTool: ToolDefinition = {
  slug: "deep-research",
  name: "Deep Research",
  description:
    "Performs comprehensive multi-step deep research on a topic: generates sub-queries, " +
    "runs parallel web searches, synthesizes a report, and saves it to a canvas. " +
    "Use for complex research questions. Takes 1–10 minutes.",
  source: "custom:deep-research",
  configSchema: DEEP_RESEARCH_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description:
          "The research topic or question to investigate in depth. " +
          "Be specific for better results. Examples: 'Impact of AI on healthcare in 2025', " +
          "'Competitive analysis of payment gateways in India'",
      },
    },
    required: ["topic"],
  },

  async execute(params, context) {
    const topic = (params["topic"] as string | undefined)?.trim();
    if (!topic) return "Error: topic is required.";

    const configResult = resolveConfig(context);
    if (typeof configResult === "string") return configResult;
    const { url } = configResult;

    console.log(`[deep-research] topic="${topic.substring(0, 80)}..."`);

    let threadId: string | null = null;
    let runId: string | null = null;

    try {
      const createRes = await fetch(`${url}/deep_research/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(30_000),
      });
      if (!createRes.ok) return `Error: Failed to create research thread (HTTP ${createRes.status}).`;

      const createData = (await createRes.json()) as { thread_id?: string };
      threadId = createData.thread_id ?? null;
      if (!threadId) return "Error: No thread_id returned from deep research service.";

      console.log(`[deep-research] Thread created ${threadId}`);

      const streamRes = await fetch(
        `${url}/deep_research/threads/${threadId}/runs/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assistant_id: "Deep Researcher",
            stream_mode: ["events"],
            config: { configurable: RESEARCH_CONFIG },
            input: { messages: [{ role: "human", content: topic }] },
          }),
        },
      );
      if (!streamRes.ok || !streamRes.body) {
        return `Error: Failed to start research stream (HTTP ${streamRes.status}).`;
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentSseEvent = "";

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEEP_RESEARCH_TIMEOUT_MS);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentSseEvent = line.slice(7).trim();
              continue;
            }
            if (!line.startsWith("data: ")) continue;

            const rawData = line.slice(6).trim();
            if (!rawData || rawData === "[DONE]") continue;

            try {
              const parsed = JSON.parse(rawData) as Record<string, unknown>;

              if (currentSseEvent === "metadata" && typeof parsed.run_id === "string") {
                runId = parsed.run_id;
                continue;
              }
              if (currentSseEvent !== "events") continue;

              const lcName = parsed.name as string | undefined;
              const lcEvent = parsed.event as string | undefined;

              if (lcEvent === "on_chain_start" && lcName) {
                const label = NODE_PROGRESS[lcName];
                if (label) {
                  console.log(`[deep-research] progress: ${label}`);
                }
              }
            } catch { /* non-JSON SSE line, skip */ }
          }
        }
      } finally {
        clearTimeout(timeoutId);
        reader.releaseLock();
      }

      const stateRes = await fetch(`${url}/deep_research/threads/${threadId}/state`);
      const finalReport = stateRes.ok
        ? ((await stateRes.json()) as { values?: { final_report?: string } }).values?.final_report ?? ""
        : "";

      console.log(`[deep-research] Done, has_report=${finalReport.length > 0}`);

      if (!finalReport) {
        return "DEEP_RESEARCH_DONE. No report was generated — do not retry this tool.";
      }

      return `DEEP_RESEARCH_DONE.\n\n${finalReport}`;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return "Error: Deep research timed out";
      }
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[deep-research] error: ${msg}`);

      if (threadId && runId) {
        fetch(`${url}/deep_research/threads/${threadId}/runs/${runId}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wait: false }),
        }).catch(() => {});
      }

      return `Error: ${msg}`;
    }
  },
};

function resolveConfig(context: ToolExecutionContext | undefined): { url: string; apiKey: string } | string {
  const config = context?.config ?? {};
  const url = config["XYNE_AI_EXTENDED_URL"] || process.env["XYNE_AI_EXTENDED_URL"] || "";
  const apiKey = config["XYNE_AI_EXTENDED_API_KEY"] || process.env["XYNE_AI_EXTENDED_API_KEY"] || "";
  if (!url) return "Error: XYNE_AI_EXTENDED_URL is not configured. Deep research is unavailable.";
  return { url, apiKey };
}
