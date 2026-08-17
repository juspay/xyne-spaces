/**
 * emit_brief — the terminal tool for DAILY BRIEF MODE (agent.config.dailyBriefMode
 * or the org's configured brief agent, dispatched with mode='daily_brief').
 *
 * The agent gathers the user's tickets / activity / calendar with read-only tools,
 * then calls emit_brief ONCE with the finished brief. The brief is EDITORIAL PROSE,
 * not a data dump: each section is an array of short, human, well-written lines
 * (see the primer in routes/run.ts). Factual claims carry inline `[clf-…#…]`
 * citation tokens copied verbatim from the tool results.
 *
 * Calling emit_brief:
 *   1. captures the brief into a closure ref (read back by run.ts), and
 *   2. HARD-STOPS the turn via abortRun (like propose-plan) — the brief IS the
 *      deliverable, there is nothing to do after emitting it.
 *
 * run.ts recovers ref.value in its catch block and ships it on the /result
 * callback as `dailyBrief`; claw-auth persists it (kind=DAILY_BRIEF).
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createLogger } from "./logger.js";

const log = createLogger("emit-brief");

export const EMIT_BRIEF_TOOL_NAME = "emit_brief";

// A brief is a scannable one-minute read — caps keep it that way.
const MAX_LINES = 12; // per section
const MAX_LINE = 1500; // per line
const MAX_SHORT = 200;

/**
 * The structured brief the agent emits. Every section is an array of prose lines
 * (markdown allowed: **bold**, links, and inline `[clf-…#…]` citation tokens).
 * Keys are snake_case to match the persisted/rendered contract.
 */
export interface DailyBriefPayload {
  generated_for: string;
  date: string;
  /** The 1–3 things that genuinely need the user today, with the reasoning. */
  what_needs_you: string[];
  /** Truly overdue items — or a single honest line when there are none. */
  overdue: string[];
  /** What the user is blocked on, with the bottleneck named. */
  waiting_on_others: string[];
  /** The user's own open work, synthesized (not a raw list). */
  assigned_to_you: string[];
  /** Today's meetings, or a single line when the day is clear. */
  todays_schedule: string[];
}

/** Shared ref the tool writes the accepted brief into (mirrors ProposePlanRef). */
export interface EmitBriefRef {
  value?: DailyBriefPayload;
  duplicates?: number;
  rejections?: number;
}

const lines = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((s) => s.length > 0)
    .map((s) => s.slice(0, MAX_LINE))
    .slice(0, MAX_LINES);

export function buildEmitBriefTool(
  ref: EmitBriefRef,
  abortRun?: () => void,
): ToolDefinition {
  return {
    name: EMIT_BRIEF_TOOL_NAME,
    label: "Emit Daily Brief",
    description: [
      "Emit the finished Daily Brief and STOP. This is your ONLY exit: once you have",
      "gathered what you need, call emit_brief exactly ONCE. Calling it ENDS your turn —",
      "do NOT keep working or call other tools after it.",
      "",
      "The brief is EDITORIAL PROSE, not a data dump. Every section is an array of short,",
      "well-written lines (2–4 lines per section is plenty). Write like a sharp chief of",
      "staff: crisp, brief, elegant, human. SYNTHESIZE — find the story across the items",
      "(e.g. 'ten tickets in PR review, not one with a reviewer assigned') rather than",
      "listing rows. Lead with the insight, then the specifics that matter.",
      "",
      "CITATIONS: after any factual claim drawn from a tool result, append the exact",
      "`[clf-…#…]` citation token(s) that appeared in that tool's output, verbatim. Never",
      "invent a token. If a claim rests on several sources, include several tokens.",
      "",
      "MENTIONS: when you name a person whose id appeared in a tool result, write them as",
      "`<@userId>`, and a channel whose id appeared as `<#channelId>` — ids copied verbatim.",
      "Never invent or infer an id; no id means write the plain name. People and channels",
      "only, never tickets or PRs.",
      "",
      "Markdown is allowed in lines (**bold**, links). A section may hold a single honest",
      "line when there's nothing (e.g. overdue: 'Nothing overdue.', schedule: 'Clear — no",
      "meetings today.') — but never emit an entirely empty brief.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        generated_for: { type: "string", description: "The user's name the brief is for." },
        date: { type: "string", description: "The date the brief covers, YYYY-MM-DD." },
        what_needs_you: {
          type: "array",
          description: "The 1–3 things that genuinely need the user today, with the why. Prose lines with [clf-…] citations.",
          items: { type: "string" },
        },
        overdue: {
          type: "array",
          description: "Truly overdue items with citations — or a single honest line if none.",
          items: { type: "string" },
        },
        waiting_on_others: {
          type: "array",
          description: "What the user is blocked on, bottleneck named, with citations.",
          items: { type: "string" },
        },
        assigned_to_you: {
          type: "array",
          description: "The user's own open work, synthesized (not a raw list), with citations.",
          items: { type: "string" },
        },
        todays_schedule: {
          type: "array",
          description: "Today's meetings with times, or a single line if the day is clear. With citations.",
          items: { type: "string" },
        },
      },
      required: [
        "generated_for",
        "date",
        "what_needs_you",
        "overdue",
        "waiting_on_others",
        "assigned_to_you",
        "todays_schedule",
      ],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const reject = (text: string) => {
        ref.rejections = (ref.rejections ?? 0) + 1;
        return { content: [{ type: "text" as const, text }], details: { error: true } };
      };
      // Idempotency: the brief is emitted EXACTLY ONCE per turn.
      if (ref.value !== undefined) {
        ref.duplicates = (ref.duplicates ?? 0) + 1;
        log.info(`[emit-brief] duplicate call #${ref.duplicates} ignored — first brief stands`);
        return {
          content: [
            {
              type: "text" as const,
              text: "You have ALREADY emitted the brief — that first call is final. Do NOT call emit_brief again. Stop here.",
            },
          ],
          details: { duplicate: true },
        };
      }

      const p = (params as Record<string, unknown> | undefined) ?? {};
      const value: DailyBriefPayload = {
        generated_for: typeof p["generated_for"] === "string" ? p["generated_for"].trim().slice(0, MAX_SHORT) : "",
        date: typeof p["date"] === "string" ? p["date"].trim().slice(0, MAX_SHORT) : "",
        what_needs_you: lines(p["what_needs_you"]),
        overdue: lines(p["overdue"]),
        waiting_on_others: lines(p["waiting_on_others"]),
        assigned_to_you: lines(p["assigned_to_you"]),
        todays_schedule: lines(p["todays_schedule"]),
      };

      const total =
        value.what_needs_you.length +
        value.overdue.length +
        value.waiting_on_others.length +
        value.assigned_to_you.length +
        value.todays_schedule.length;
      if (total === 0) {
        return reject(
          "Rejected: the brief is empty. Gather the user's tickets, activity, and calendar first, then call emit_brief with at least a line or two per section (a single honest line like 'Nothing overdue.' is fine for an empty section).",
        );
      }

      ref.value = value;
      log.info(
        `[emit-brief] accepted for="${value.generated_for}" date=${value.date} lines: needs=${value.what_needs_you.length} overdue=${value.overdue.length} waiting=${value.waiting_on_others.length} assigned=${value.assigned_to_you.length} schedule=${value.todays_schedule.length}`,
      );

      try {
        abortRun?.();
      } catch {
        // Never let an abort-wiring bug poison the brief path.
      }

      return {
        content: [{ type: "text" as const, text: "STOP — daily brief emitted. Do NOT continue or call any more tools." }],
        details: { lines: total },
      };
    },
  };
}
