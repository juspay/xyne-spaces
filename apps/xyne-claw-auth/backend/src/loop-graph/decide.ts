import type { DecideQuestion } from "xyne-claw-shared";
import { tryChecksViaClaw, type XorTryAnswer } from "../services/xorTryClient.js";
import { createLogger } from "../logger.js";
import type { LoopNode } from "./engine.js";

const log = createLogger("loop-graph");

const MAX_STATE_CHARS = 12_000;

export interface Decision {
  answers: Record<string, XorTryAnswer>;
  unavailable: boolean;
  error?: string;
}

export type DecideAsk = typeof tryChecksViaClaw;

export function xorDecideNode<L extends { decision?: Decision }, C>(opts: {
  questions: readonly DecideQuestion[];
  state: (ledger: L, ctx: C) => string;
  context?: string;
  ask?: DecideAsk;
}): LoopNode<L, C, never> {
  return {
    kind: "decide",
    run: async (ledger, ctx) => {
      const ask = opts.ask ?? tryChecksViaClaw;
      const text = opts.state(ledger, ctx).trim().slice(-MAX_STATE_CHARS);
      const result = text
        ? await ask({
            questions: [...opts.questions],
            item: { text },
            ...(opts.context ? { context: opts.context } : {}),
          })
        : { ok: false as const, status: 400, error: "nothing to judge" };
      const decision: Decision = result.ok
        ? { answers: result.answers, unavailable: result.unavailable }
        : { answers: {}, unavailable: true, error: result.error };
      log.info(
        `[loop] decide ${opts.questions.map((q) => `${q.id}=${formatAnswer(decision.answers[q.id])}`).join(" ")}${decision.unavailable ? " (xor unavailable)" : ""}`,
      );
      return { ledger: { ...ledger, decision } };
    },
  };
}

function formatAnswer(answer: XorTryAnswer | undefined): string {
  if (!answer || answer.value === null) return "none";
  return `${String(answer.value)}${answer.unsure ? "?" : ""}(${answer.confidence ?? "-"})`;
}

export function decided(decision: Decision | undefined, question: string, value: string | number | boolean): boolean {
  const answer = decision?.answers[question];
  return Boolean(answer && !answer.unsure && answer.value === value);
}

export function unsure(decision: Decision | undefined, question: string): boolean {
  const answer = decision?.answers[question];
  return !decision || decision.unavailable || !answer || answer.unsure || answer.value === null;
}
