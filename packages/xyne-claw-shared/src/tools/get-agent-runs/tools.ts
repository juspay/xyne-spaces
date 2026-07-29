/**
 * get-agent-runs — system introspection tool. Any agent can call it to ask
 * "show me the recent runs of agent X" without needing admin privileges.
 *
 * Hits claw-auth's GET /claw/api/v1/runs/by-agent/:slug endpoint (S2S-gated).
 * The endpoint joins agent_runs to users so the result has email + name per
 * row — the calling agent can render a human-readable list directly.
 *
 * Returns a JSON string the calling LLM can paraphrase or table-format for
 * the user. NOT marked as a write tool; safe to call anytime.
 */

import type { ToolDefinition } from "../types.js";

const AUTH_URL =
  process.env["XYNE_CLAW_AUTH_URL"] ?? "http://xyne-claw-auth.xyne-apps.svc.cluster.local:3003";

const S2S_KEY = process.env["XYNE_CLAW_S2S_KEY"] ?? "";

interface RunSummary {
  sessionId: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  agentSlug: string;
  status: string;
  triggerSource: string;
  task: string | null;
  conversationId: string | null;
  channelId: string | null;
  toolsUsed: string[];
  tokensIn: number | null;
  tokensOut: number | null;
  totalMs: number | null;
  rating: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface ApiResponse {
  success: boolean;
  data?: {
    agentSlug: string;
    agentName: string;
    sinceDays: number;
    limit: number;
    statusFilter?: string;
    totalReturned: number;
    runs: RunSummary[];
  };
  error?: string;
}

export const getAgentRunsTool: ToolDefinition = {
  slug: "get-agent-runs",
  name: "Get Agent Runs",
  description:
    "List recent runs of a specific agent across all users. Use when the user asks 'how many runs did <agent> have', 'show me recent activity for <agent>', 'who used <agent> this week', or similar. " +
    "Returns up to 200 most recent runs with sessionId, user email, user name, status (running/completed/failed/cancelled), trigger source (spaces/scheduled/chat/api), truncated task (first 240 chars), conversation + channel ID, tool count + names, token usage, latency, rating, and timestamps. " +
    "Pass the agent's slug (e.g. 'pr-rules-miner', 'credit-appraisal-agent'). Optional filters: sinceDays (1-365, default 30), limit (1-200, default 50), status (running | completed | failed | cancelled).",
  source: "custom:system",
  inputSchema: {
    type: "object",
    properties: {
      agentSlug: {
        type: "string",
        description:
          "The slug of the agent to list runs for, e.g. 'pr-rules-miner' or 'credit-appraisal-agent'. Required.",
      },
      sinceDays: {
        type: "number",
        description: "How many days back to look. Default 30, max 365.",
      },
      limit: {
        type: "number",
        description: "Maximum number of runs to return. Default 50, max 200.",
      },
      status: {
        type: "string",
        description:
          "Optional status filter: 'running' | 'completed' | 'failed' | 'cancelled'. Omit for all statuses.",
      },
    },
    required: ["agentSlug"],
  },
  execute: async (params, _context) => {
    const agentSlug = String(params["agentSlug"] ?? "").trim();
    if (!agentSlug) {
      return JSON.stringify({ error: "agentSlug is required" });
    }
    const sinceDays = typeof params["sinceDays"] === "number" ? params["sinceDays"] : undefined;
    const limit = typeof params["limit"] === "number" ? params["limit"] : undefined;
    const status = typeof params["status"] === "string" ? params["status"] : undefined;

    const qs = new URLSearchParams();
    if (sinceDays != null) qs.set("sinceDays", String(sinceDays));
    if (limit != null) qs.set("limit", String(limit));
    if (status) qs.set("status", status);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";

    const url = `${AUTH_URL.replace(/\/$/, "")}/claw/api/v1/runs/by-agent/${encodeURIComponent(agentSlug)}${suffix}`;

    if (!S2S_KEY) {
      return JSON.stringify({
        error:
          "XYNE_CLAW_S2S_KEY not set in claw-pod environment — get-agent-runs cannot authenticate to claw-auth. Ask the admin to configure it.",
      });
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { "x-s2s-key": S2S_KEY },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: `Failed to reach claw-auth at ${url}: ${msg}` });
    }

    const text = await res.text().catch(() => "");

    if (res.status === 404) {
      return JSON.stringify({
        error: `Agent "${agentSlug}" not found. Check the slug — it should match exactly what's in the admin UI (e.g. 'pr-rules-miner', not 'PR Rules Miner').`,
      });
    }
    if (!res.ok) {
      return JSON.stringify({ error: `HTTP ${res.status}: ${text.slice(0, 300)}` });
    }

    let json: ApiResponse;
    try {
      json = JSON.parse(text) as ApiResponse;
    } catch {
      return JSON.stringify({ error: `Unparseable response from claw-auth: ${text.slice(0, 300)}` });
    }

    if (!json.success || !json.data) {
      return JSON.stringify({ error: json.error ?? "Unknown error from claw-auth" });
    }

    // Stable return shape the calling LLM can table-format directly. Echo the
    // key summary fields up top so the model doesn't have to compute them.
    return JSON.stringify(
      {
        agentSlug: json.data.agentSlug,
        agentName: json.data.agentName,
        windowDays: json.data.sinceDays,
        totalRuns: json.data.totalReturned,
        statusFilter: json.data.statusFilter ?? "all",
        runs: json.data.runs.map((r) => ({
          sessionId: r.sessionId,
          user: r.userEmail ?? r.userName ?? r.userId,
          status: r.status,
          trigger: r.triggerSource,
          task: r.task,
          conversation: r.conversationId,
          channel: r.channelId,
          toolCount: r.toolsUsed?.length ?? 0,
          tools: r.toolsUsed?.slice(0, 5) ?? [],
          tokens: r.tokensIn != null && r.tokensOut != null
            ? { in: r.tokensIn, out: r.tokensOut }
            : null,
          durationMs: r.totalMs,
          rating: r.rating,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
        })),
      },
      null,
      2,
    );
  },
};
