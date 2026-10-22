import { describe, expect, it, vi } from "vitest";
import { expandVariants, findRegressions, formatEvalReport, runChecksEval, type EvalSample } from "../src/xor-eval.js";
import { loadUiTesterEvalSet, uiTesterStandardChecks } from "../src/ui-tester/eval-set.js";
import type { DecideQuestion } from "../src/xor-decide.js";

const CHECKS: DecideQuestion[] = [
  { id: "failure", question: "Is this a real failure?", type: "yesno" },
  { id: "cause", question: "Which part failed?", type: "choice", options: { db: "database", net: "network" } },
];

const SAMPLES: EvalSample[] = [
  { id: "a", text: "ERROR db refused", expected: { failure: true, cause: "db" } },
  { id: "b", text: "INFO ok", expected: { failure: false } },
  { id: "c", text: "ERROR timeout", expected: { failure: true, cause: "net" } },
];

function ask(byModel: Record<string, (state: string, q: Record<string, unknown>) => Record<string, unknown>>) {
  return vi.fn(async (req: { state: string; questions: Record<string, unknown>; model?: string }) => byModel[req.model ?? ""]!(req.state, req.questions));
}

describe("runChecksEval", () => {
  it("scores each check per model: confident-right, confident-wrong and unsure", async () => {
    const a = ask({
      good: (s) => ({
        failure: { type: "noul", noul: s.includes("ERROR") ? 0.98 : 0.03 },
        cause: { type: "choice", choice: s.includes("db") ? "db" : "net", confidence: 0.9 },
      }),
      worse: (s) => ({
        failure: { type: "noul", noul: s.includes("ERROR") ? 0.55 : 0.9 },
        cause: { type: "choice", choice: "db", confidence: 0.95 },
      }),
    });
    const report = await runChecksEval({ checks: CHECKS, samples: SAMPLES, models: ["good", "worse"], ask: a as never });
    expect(a).toHaveBeenCalledTimes(6);
    const [good, worse] = report.models;
    expect(good!.overall).toMatchObject({ labelled: 5, correct: 5, confidentWrong: 0, unsure: 0, accuracy: 100 });
    expect(worse!.checks.find((c) => c.id === "failure")).toMatchObject({ labelled: 3, correct: 0, unsure: 2, confidentWrong: 1, matched: 2 });
    expect(worse!.checks.find((c) => c.id === "cause")).toMatchObject({ correct: 1, confidentWrong: 1, accuracy: 50 });
    const regressions = findRegressions(good!, worse!);
    expect(regressions.map((r) => r.id)).toEqual(["overall", "failure", "cause"]);
    const md = formatEvalReport(report, "log triage");
    expect(md).toContain("| **overall** | 100% / 0% / 0 | 20% / 40% / 2 |");
    expect(md).toContain("### Regressions vs good");
  });

  it("only asks the checks a sample is labelled for, and skips samples with none", async () => {
    const a = ask({ m: () => ({ failure: { type: "noul", noul: 0.1 } }) });
    await runChecksEval({ checks: CHECKS, samples: [SAMPLES[1]!, { id: "x", text: "y", expected: {} }], models: ["m"], ask: a as never });
    expect(a).toHaveBeenCalledTimes(1);
    expect(Object.keys((a.mock.calls[0]![0] as { questions: object }).questions)).toEqual(["failure"]);
  });

  it("scores phrasing variants against the same labels and reports the better one", async () => {
    const variants = { failure: ["Does this line report an error that needs fixing?"] };
    expect(expandVariants(CHECKS, variants).map((c) => c.id)).toEqual(["failure", "failure~1", "cause"]);
    const a = ask({
      m: (s, q) => ({
        ...(q["failure"] ? { failure: { type: "noul", noul: 0.6 } } : {}),
        ...(q["failure~1"] ? { "failure~1": { type: "noul", noul: s.includes("ERROR") ? 0.97 : 0.02 } } : {}),
      }),
    });
    const report = await runChecksEval({ checks: [CHECKS[0]!], samples: SAMPLES, models: ["m"], variants, ask: a as never });
    const v = report.models[0]!.checks.find((c) => c.id === "failure~1")!;
    expect(v).toMatchObject({ variantOf: "failure", accuracy: 100 });
    expect(report.models[0]!.overall.labelled).toBe(3);
    expect(formatEvalReport(report)).toContain('"Does this line report an error that needs fixing?" beats failure (0% → 100%)');
  });

  it("uses per-sample checks when a sample carries its own statements", async () => {
    const a = ask({ m: () => ({ s1: { type: "noul", noul: 0.95 } }) });
    const report = await runChecksEval({
      checks: CHECKS,
      samples: [{ id: "page", image: "data:image/png;base64,AAAA", checks: [{ id: "s1", question: "A form is shown.", type: "yesno" }], expected: { s1: true } }],
      models: ["m"],
      ask: a as never,
    });
    expect(report.models[0]!.checks[0]).toMatchObject({ id: "page/s1", accuracy: 100 });
  });
});

describe("ui-tester eval set", () => {
  it("maps the standard questions and loads every labelled screenshot", async () => {
    expect(uiTesterStandardChecks().map((c) => c.id)).toEqual(["cut_off", "overlap", "errors", "placeholders", "toasts", "content", "background"]);
    const set = await loadUiTesterEvalSet();
    expect(set.samples.length).toBeGreaterThanOrEqual(30);
    expect(set.samples.every((s) => s.image?.startsWith("data:image/jpeg;base64,"))).toBe(true);
    const ids = new Set(set.checks.map((c) => c.id));
    for (const s of set.samples.filter((x) => !x.checks)) for (const k of Object.keys(s.expected)) expect(ids.has(k)).toBe(true);
  });
});
