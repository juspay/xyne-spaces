import type { DecideQuestion } from "xyne-claw-shared";
import type { XorEvalResult } from "../services/xorTryClient.js";
import type { SubagentSample } from "./subagent-resolver.js";

export const GATE_MIN_SAMPLES = 3;
export const GATE_MAX_DROP = 5;

export type EvalFn = (req: { checks: DecideQuestion[]; samples: SubagentSample[] }) => Promise<XorEvalResult>;

export type GateResult =
  | { blocked: false; reason: "unchanged" | "too-few-samples" | "eval-unavailable" | "ok"; from?: number; to?: number }
  | { blocked: true; from: number; to: number; confidentWrongFrom: number; confidentWrongTo: number; markdown: string };

export async function runRegressionGate(input: {
  oldChecks: DecideQuestion[] | null;
  newChecks: DecideQuestion[] | null | undefined;
  samples: SubagentSample[];
  evaluate: EvalFn;
}): Promise<GateResult> {
  const { oldChecks, newChecks, samples } = input;
  if (newChecks === undefined || !newChecks || !oldChecks || oldChecks.length === 0 || JSON.stringify(oldChecks) === JSON.stringify(newChecks)) {
    return { blocked: false, reason: "unchanged" };
  }
  if (samples.length < GATE_MIN_SAMPLES) return { blocked: false, reason: "too-few-samples" };
  const [before, after] = await Promise.all([input.evaluate({ checks: oldChecks, samples }), input.evaluate({ checks: newChecks, samples })]);
  const b = before.ok ? before.report.models[0]?.overall : undefined;
  const a = after.ok ? after.report.models[0]?.overall : undefined;
  if (!b || !a) return { blocked: false, reason: "eval-unavailable" };
  if (a.accuracy < b.accuracy - GATE_MAX_DROP || a.confidentWrong > b.confidentWrong + 1) {
    return {
      blocked: true,
      from: b.accuracy,
      to: a.accuracy,
      confidentWrongFrom: b.confidentWrong,
      confidentWrongTo: a.confidentWrong,
      markdown: after.ok ? after.markdown : "",
    };
  }
  return { blocked: false, reason: "ok", from: b.accuracy, to: a.accuracy };
}
