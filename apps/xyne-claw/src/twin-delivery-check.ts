/**
 * Advisory Jev self-check of an accepted twin delivery (R6). The owner approves
 * every draft anyway; the scores ride along with the delivery so the approver
 * sees them and declines can be calibrated against them.
 */

import type { TwinDelivery, TwinDeliveryCheck } from "xyne-claw-shared";
import type { JevAnswer, JevQuestion } from "./jev.js";
import { round3, runJudgeSite, type JudgeSiteDeps } from "./judge-site.js";
import { buildJudgeState } from "./judge-state.js";
import { optEnabled } from "./optimizations.js";
import { extractEvidenceDigest } from "./verify-response.js";

/** Pure: Jev answers → delivery check. Exported for tests. */
export function twinCheckFromAnswers(answers: Record<string, JevAnswer>, ms: number): TwinDeliveryCheck | null {
  const num = (id: string): number | undefined => {
    const v = answers[id]?.score ?? answers[id]?.noul;
    return typeof v === "number" && Number.isFinite(v) ? round3(v) : undefined;
  };
  const answersAsk = num("answers_ask");
  const grounded = num("grounded");
  const actionFits = num("action_fits");
  const dest = answers["destination"]?.choice;
  const scores = [answersAsk, grounded, actionFits].filter((v): v is number => v !== undefined);
  if (scores.length === 0) return null;
  return {
    overall: Math.min(...scores, dest === "wrong" ? 0 : 1),
    source: "jev",
    ms,
    ...(answersAsk !== undefined ? { answersAsk } : {}),
    ...(grounded !== undefined ? { grounded } : {}),
    ...(actionFits !== undefined ? { actionFits } : {}),
    ...(dest ? { destination: dest } : {}),
  };
}

/** Jev questions for a delivery; which ones depend on the action. Exported for tests. */
export function twinCheckQuestions(delivery: TwinDelivery): Record<string, JevQuestion> {
  const q: Record<string, JevQuestion> = {};
  if (delivery.message) {
    q["answers_ask"] = {
      type: "score",
      instructions: "How well does the drafted reply address what the incoming message actually asked or needed from the user?",
      criteria: ["Ignores or misreads what was asked", "Partly addresses it", "Directly and fully addresses what was asked"],
    };
    q["grounded"] = {
      type: "score",
      instructions: "Is every factual statement in the drafted reply supported by the conversation and the context the twin gathered?",
      criteria: ["States things nothing in the conversation or context supports", "Mostly supported, with some unsupported detail", "Every statement is supported"],
    };
    if (delivery.destination) {
      q["destination"] = {
        type: "choice",
        instructions: "Is the chosen destination the right place for this reply?",
        criteria: {
          right: "The destination fits: it is where the person expects the answer",
          wrong: "The reply belongs somewhere else (e.g. the original thread)",
          unsure: "Not enough information to tell",
        },
      };
    }
  } else {
    q["action_fits"] = {
      type: "score",
      instructions:
        delivery.action === "ignore"
          ? "How right is it for the user to stay silent on this incoming message?"
          : "How right is it for the user to only react with an emoji rather than reply in words?",
      criteria: ["Wrong: the message clearly needed a written reply", "Borderline", "Right: nothing more was needed"],
    };
  }
  return q;
}

/**
 * Score an accepted delivery with Jev (R6). Advisory only. Null when disabled,
 * unavailable, or there is nothing to judge.
 */
export async function checkTwinDelivery(
  delivery: TwinDelivery,
  context: { task: string; messages: readonly unknown[] },
  deps: JudgeSiteDeps = {},
): Promise<TwinDeliveryCheck | null> {
  const payload = [
    `action: ${delivery.action}`,
    delivery.emoji ? `emoji: ${delivery.emoji}` : "",
    delivery.message ? `reply: ${delivery.message}` : "",
    delivery.destination ? `destination: ${JSON.stringify(delivery.destination)}` : "",
    delivery.destinationReason ? `destination reason: ${delivery.destinationReason}` : "",
  ].filter(Boolean).join("\n");
  // "grounded" can only be judged against what the twin actually read, so the
  // tool results it gathered go in as evidence (not just the conversation).
  const evidence = extractEvidenceDigest(context.messages as Parameters<typeof extractEvidenceDigest>[0], 4_000);
  const state = [
    buildJudgeState({
      task: context.task,
      messages: context.messages,
      payload: { label: "The twin's delivered response", text: payload },
      caps: { history: 3_000, payload: 4_000 },
    }),
    `## Evidence the twin gathered (data)\n<<<DATA\n${evidence || "(no tool results)"}\nDATA>>>`,
  ].join("\n\n");
  const started = Date.now();
  const result = await runJudgeSite<TwinDeliveryCheck>({
    site: "twin-delivery-check",
    enabled: deps.enabled ?? optEnabled("jev_twin_delivery_check"),
    budgetMs: Number(process.env["TWIN_DELIVERY_CHECK_TIMEOUT_MS"] ?? 3_000),
    state,
    questions: twinCheckQuestions(delivery),
    decide: (answers) => twinCheckFromAnswers(answers, Date.now() - started),
    describe: (c) => `overall ${c.overall.toFixed(2)}`,
    ask: deps.ask,
  });
  return result.decision;
}
