/**
 * The metrics half of a claw terminal callback.
 *
 * xyne-claw builds ONE terminal payload for every run and posts it to whichever
 * callback URL the caller supplied. claw-auth then has five handlers that
 * finalize the AgentRun — /webhook/result, /sessions/:id/result, the run-stream
 * callback, the scheduled-jobs result, and the error-pipeline result — and each
 * one used to pick fields out of that payload by hand.
 *
 * They drifted. Only /webhook/result forwarded the latency block, so every run
 * that completed through streaming chat, a scheduled job, or the error pipeline
 * stored NULL for totalMs / llmTurns / ttftMs and never appeared in the latency
 * charts at all. `llmCalls` was worse: it reached exactly one branch of one
 * handler.
 *
 * This is the single reader. Handlers spread its result into finalize() and get
 * the same coverage by construction. Every field stays optional — absent means
 * "this callback did not carry it", and finalize() leaves the column untouched
 * rather than writing a zero.
 */

import type { FinalizeRunInput } from "../repositories/agentRunRepository.js";

/** The subset of a claw terminal callback that carries run metrics. */
export interface ClawMetricsPayload {
  toolInvocations?: unknown;
  tokenUsage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  latency?: FinalizeRunInput["latency"];
  citationReflection?: FinalizeRunInput["citationReflection"];
  llmCalls?: unknown;
}

type MetricsFields = Pick<
  FinalizeRunInput,
  "toolInvocations" | "tokenUsage" | "latency" | "citationReflection" | "llmCalls"
>;

/**
 * Picks the metrics fields a callback actually carried.
 *
 * Accepts the loose `Record<string, unknown>` shape the handlers cast their
 * request bodies to, so no call site needs its own type widening.
 */
export function clawMetricsFields(payload: ClawMetricsPayload | Record<string, unknown>): MetricsFields {
  const p = payload as ClawMetricsPayload;
  return {
    ...(p.toolInvocations !== undefined ? { toolInvocations: p.toolInvocations } : {}),
    ...(p.tokenUsage ? { tokenUsage: p.tokenUsage } : {}),
    ...(p.latency ? { latency: p.latency } : {}),
    ...(p.citationReflection ? { citationReflection: p.citationReflection } : {}),
    ...(p.llmCalls !== undefined ? { llmCalls: p.llmCalls } : {}),
  };
}
