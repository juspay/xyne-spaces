import { describe, expect, it, vi } from "vitest";
import type { DecideQuestion } from "xyne-claw-shared";
import { runRegressionGate } from "./subagent-eval-gate.js";
import type { XorEvalResult } from "../services/xorTryClient.js";

const OLD: DecideQuestion[] = [{ id: "failure", question: "Is this a real failure?", type: "yesno" }];
const NEW: DecideQuestion[] = [{ id: "failure", question: "Is it bad?", type: "yesno" }];
const SAMPLES = [1, 2, 3, 4].map((i) => ({ input: `line ${i}`, expected: { failure: i % 2 === 0 } }));

const result = (accuracy: number, confidentWrong = 0): XorEvalResult => ({
  ok: true,
  report: {
    samples: 4,
    ranAt: "t",
    models: [{ model: "m", overall: { labelled: 4, correct: 0, confidentWrong, unsure: 0, accuracy, unsureRate: 0 }, checks: [], meanMs: 10, unavailable: 0 }],
  },
  regressions: [],
  markdown: `acc ${accuracy}`,
});

const evaluateWith = (before: XorEvalResult, after: XorEvalResult) =>
  vi.fn(async (r: { checks: DecideQuestion[] }) => (r.checks === OLD ? before : after));

describe("runRegressionGate", () => {
  it("blocks when the new checks score clearly worse on the samples", async () => {
    const evaluate = evaluateWith(result(100), result(50, 2));
    const g = await runRegressionGate({ oldChecks: OLD, newChecks: NEW, samples: SAMPLES, evaluate });
    expect(g).toEqual({ blocked: true, from: 100, to: 50, confidentWrongFrom: 0, confidentWrongTo: 2, markdown: "acc 50" });
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("lets a small drop or an improvement through", async () => {
    expect(await runRegressionGate({ oldChecks: OLD, newChecks: NEW, samples: SAMPLES, evaluate: evaluateWith(result(80), result(77)) })).toMatchObject({ blocked: false, reason: "ok" });
    expect(await runRegressionGate({ oldChecks: OLD, newChecks: NEW, samples: SAMPLES, evaluate: evaluateWith(result(60), result(90)) })).toMatchObject({ blocked: false, reason: "ok" });
  });

  it("skips the eval when checks are unchanged or omitted, or samples are too few", async () => {
    const evaluate = evaluateWith(result(100), result(0));
    expect(await runRegressionGate({ oldChecks: OLD, newChecks: OLD, samples: SAMPLES, evaluate })).toMatchObject({ reason: "unchanged" });
    expect(await runRegressionGate({ oldChecks: OLD, newChecks: undefined, samples: SAMPLES, evaluate })).toMatchObject({ reason: "unchanged" });
    expect(await runRegressionGate({ oldChecks: OLD, newChecks: NEW, samples: SAMPLES.slice(0, 2), evaluate })).toMatchObject({ reason: "too-few-samples" });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("never blocks a save because xor is down", async () => {
    const down: XorEvalResult = { ok: false, status: 502, error: "down" };
    expect(await runRegressionGate({ oldChecks: OLD, newChecks: NEW, samples: SAMPLES, evaluate: evaluateWith(down, result(0)) })).toMatchObject({ blocked: false, reason: "eval-unavailable" });
  });
});
