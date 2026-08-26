import crypto from "node:crypto";
import type { ToolDefinition } from "../types.js";
import { publishUiWidget } from "../ui-widget.js";

/**
 * collect-feedback — post a small, configurable button row after a run so the
 * user can rate the result (e.g. an RCA agent asking "Was this RCA correct?").
 * The clicked value is verified and recorded on the run's rating signal in
 * claw-auth; unlike ask-user-question it does NOT stop the run or start a new
 * one — it is fire-and-forget.
 *
 * Options default to 👍 Like / 👎 Dislike when the agent supplies none. Each
 * option is { label, value, sentiment? }, where sentiment ("up"|"down")
 * optionally maps the choice onto the run's thumbs rating.
 */

const DEFAULT_OPTIONS = [
  { label: "👍 Like", value: "like", sentiment: "up" as const },
  { label: "👎 Dislike", value: "dislike", sentiment: "down" as const },
];

interface FeedbackOptionInput {
  label?: unknown;
  value?: unknown;
  sentiment?: unknown;
}

export const COLLECT_FEEDBACK_CONFIG_SCHEMA = {
  XYNE_CLAW_AUTH_URL: {
    label: "Claw Auth Service URL",
    default: "http://localhost:3003",
    required: true as const,
    placeholder: "http://localhost:3003",
  },
};

export const collectFeedback: ToolDefinition = {
  slug: "collect-feedback",
  name: "Collect Feedback",
  description:
    "Post a short row of feedback buttons after you finish a response so the user can rate it. " +
    "Use it at the very end of a turn (for example an RCA agent asking whether the analysis was correct). " +
    "Provide a `prompt` and 2-6 `options`; each option is { label, value } with an optional " +
    "`sentiment` of 'up' or 'down' that records a thumbs rating on the run. Omit `options` to use the " +
    "built-in 👍 Like / 👎 Dislike buttons. Unlike ask-user-question this does NOT pause the run or start " +
    "a new one — the click is recorded in the background — so you may keep it as the last thing you do. " +
    "Call it at most once per turn.",
  source: "custom:collect-feedback",
  configSchema: COLLECT_FEEDBACK_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Short question shown above the buttons, e.g. 'Was this RCA correct?'",
      },
      options: {
        type: "array",
        description:
          "2-6 feedback buttons. Each is { label, value, sentiment? }. Omit to use 👍 Like / 👎 Dislike.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Button text, e.g. 'RCA is correct'" },
            value: { type: "string", description: "Machine value captured on click, e.g. 'rca_correct'" },
            sentiment: {
              type: "string",
              enum: ["up", "down"],
              description: "Optional thumbs mapping recorded on the run's rating.",
            },
          },
          required: ["label", "value"],
        },
      },
    },
    required: ["prompt"],
  },
  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const prompt = typeof params["prompt"] === "string" ? params["prompt"].trim() : "";
    if (!prompt) return "Error: provide a non-empty prompt.";

    const rawOptions = params["options"];
    let options = DEFAULT_OPTIONS as { label: string; value: string; sentiment?: "up" | "down" }[];
    if (Array.isArray(rawOptions) && rawOptions.length > 0) {
      const parsed: { label: string; value: string; sentiment?: "up" | "down" }[] = [];
      for (const raw of rawOptions as FeedbackOptionInput[]) {
        const label = typeof raw?.label === "string" ? raw.label.trim() : "";
        const value = typeof raw?.value === "string" ? raw.value.trim() : "";
        if (!label || !value) return "Error: each option needs a non-empty label and value.";
        const sentiment = raw?.sentiment === "up" || raw?.sentiment === "down" ? raw.sentiment : undefined;
        parsed.push(sentiment ? { label, value, sentiment } : { label, value });
      }
      if (parsed.length < 2 || parsed.length > 6) return "Error: provide 2-6 options.";
      if (new Set(parsed.map((o) => o.value)).size !== parsed.length) {
        return "Error: each option value must be unique.";
      }
      options = parsed;
    }

    const sessionId = context.sessionId;
    if (!sessionId) return "Error: collect-feedback is only available inside a claw agent run.";

    const meta = context.meta ?? {};
    const authUrl = (
      context.config["XYNE_CLAW_AUTH_URL"] ??
      process.env["XYNE_CLAW_AUTH_URL"] ??
      context.config["CLAW_AUTH_URL"] ??
      process.env["CLAW_AUTH_URL"] ??
      "http://localhost:3003"
    ).replace(/\/+$/, "");
    const feedbackId = crypto.randomUUID();

    try {
      const res = await fetch(`${authUrl}/claw/api/v1/pending-feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(context.s2sKey ? { "x-s2s-key": context.s2sKey } : {}),
        },
        body: JSON.stringify({
          feedbackId,
          sessionId,
          userId: meta["userId"],
          agentSlug: meta["agentSlug"],
          channelId: meta["channelId"],
          conversationId: meta["conversationId"],
          prompt,
          options,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return `Error storing feedback request: HTTP ${res.status} ${body.slice(0, 120)}`;
      }
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!data.success) return `Error storing feedback request: ${data.error ?? "unknown"}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
      return `Error posting feedback request to ${authUrl}: ${message}${cause}`;
    }

    try {
      await publishUiWidget(context, {
        id: `feedback:${feedbackId}`,
        type: "feedback",
        operation: "create",
        payload: { feedbackId, sessionId, prompt, options },
      });
    } catch {
      // The final callback's pendingFeedback list is the durable fallback.
    }

    return `Posted a feedback prompt ("${prompt}") with ${options.length} option(s). The user's choice will be recorded in the background — do not wait for it.`;
  },
};
