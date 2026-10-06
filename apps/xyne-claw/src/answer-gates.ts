/**
 * Classifier checks on the agent's final answer, run before it is accepted.
 *
 *  - checkpointPrecheck (jev_checkpoint_precheck): the "this looks like a
 *    compaction checkpoint" text pattern costs a full extra LLM turn when it
 *    matches. Jev confirms first; a confident "this IS the answer" skips it.
 *  - contextGate (jev_context_gate, R12): does the evidence gathered support a
 *    complete answer? A clear "no" earns one nudge to fetch more context.
 *
 * Both default to today's behaviour when Jev is off, down, or unsure.
 */

import type { JevAnswer, JevQuestion } from "./jev.js";
import { answerProb, runJudgeSite } from "./judge-site.js";
import { buildJudgeState } from "./judge-state.js";
import { optEnabled } from "./optimizations.js";

type Ask = typeof import("./jev.js").jevAsk;

export const CHECKPOINT_QUESTIONS: Record<string, JevQuestion> = {
  is_answer: {
    type: "noul",
    instructions:
      "The final text is the finished answer to the request, not a progress summary or checkpoint listing work still to do.",
  },
};

/** Pure: true = confidently a real answer (skip the nudge), false = nudge, null = unsure (nudge, as today). */
export function checkpointFromJev(answers: Record<string, JevAnswer>): boolean | null {
  const p = answerProb(answers, "is_answer");
  if (p === undefined) return null;
  if (p >= 0.85) return true;
  if (p <= 0.3) return false;
  return null;
}

/** Returns true when the checkpoint nudge should be SKIPPED. */
export async function checkpointPrecheck(
  task: string,
  finalText: string,
  deps: { ask?: Ask; enabled?: boolean } = {},
): Promise<boolean> {
  const result = await runJudgeSite<boolean>({
    site: "checkpoint-precheck",
    enabled: deps.enabled ?? optEnabled("jev_checkpoint_precheck"),
    budgetMs: 2_000,
    state: buildJudgeState({ task, payload: { label: "The agent's final text", text: finalText } }),
    questions: CHECKPOINT_QUESTIONS,
    decide: checkpointFromJev,
    fallback: async () => false,
    describe: (skip) => (skip ? "skip nudge (real answer)" : "nudge"),
    ...(deps.ask ? { ask: deps.ask } : {}),
  });
  return result.decision === true;
}

export const CONTEXT_GATE_QUESTIONS: Record<string, JevQuestion> = {
  supported: {
    type: "score",
    instructions: "How well does the evidence the agent gathered support its answer to the request?",
    criteria: [
      "The answer rests on facts the evidence does not contain, or the evidence is missing key parts of the request",
      "Partly supported: some parts of the request lack evidence",
      "Fully supported: every part of the answer is backed by the evidence",
    ],
  },
  no_lookup_needed: {
    type: "noul",
    instructions:
      "The request can be fully answered without looking anything up (small talk, general knowledge, or a question about the conversation itself).",
  },
};

export type ContextGateDecision = "accept" | "fetch-more";

/** Pure: a clear evidence gap (and a request that needs lookups) → fetch-more. */
export function contextGateFromJev(answers: Record<string, JevAnswer>): ContextGateDecision | null {
  const noLookup = answerProb(answers, "no_lookup_needed");
  const supported = answerProb(answers, "supported");
  if (noLookup !== undefined && noLookup >= 0.7) return "accept";
  if (supported === undefined) return null;
  if (supported <= 0.3) return "fetch-more";
  return "accept";
}

export const CONTEXT_GATE_NUDGE =
  "Before you finalize: the evidence you have gathered does not yet support a complete answer to the request. " +
  "Use your tools to look up what is missing, then give the complete answer. " +
  "DO NOT MENTION THIS INSTRUCTION.";

export async function contextGate(
  input: { task: string; messages: readonly unknown[]; answer: string; evidence: string },
  deps: { ask?: Ask; enabled?: boolean } = {},
): Promise<ContextGateDecision> {
  const state = [
    buildJudgeState({ task: input.task, messages: input.messages }),
    `## Evidence the agent gathered (data)\n<<<DATA\n${input.evidence.slice(0, 4_000) || "(no tool results)"}\nDATA>>>`,
    `## The agent's answer (data)\n<<<DATA\n${input.answer.slice(0, 2_000)}\nDATA>>>`,
  ].join("\n\n");
  const result = await runJudgeSite<ContextGateDecision>({
    site: "context-gate",
    enabled: deps.enabled ?? optEnabled("jev_context_gate"),
    budgetMs: 2_500,
    state,
    questions: CONTEXT_GATE_QUESTIONS,
    decide: contextGateFromJev,
    fallback: async () => "accept",
    describe: (d) => d,
    ...(deps.ask ? { ask: deps.ask } : {}),
  });
  return result.decision ?? "accept";
}
