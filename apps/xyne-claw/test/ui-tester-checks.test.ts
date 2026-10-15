import { describe, expect, it } from "vitest";
import { buildQuestions, formatReport, judgeVariation, STANDARD_QUESTIONS, type VariationResult } from "../src/ui-tester/checks.js";
import type { XorAnswer } from "../src/xor.js";

const clean = { viewportWidth: 1440, horizontalScroll: false, offRight: [], narrowText: 0, garbage: [], duplicateToasts: [], errorBoundary: false, dark: false, textLength: 900 };

function answers(over: Record<string, [string, number]> = {}): Record<string, XorAnswer> {
  const base: Record<string, [string, number]> = {
    cut_off: ["no", 0.9], overlap: ["no", 0.9], errors: ["none", 0.9], placeholders: ["no", 0.9],
    toasts: ["none", 0.9], content: ["data", 0.9], background: ["light", 0.9], ...over,
  };
  return Object.fromEntries(Object.entries(base).map(([k, [choice, confidence]]) => [k, { type: "choice", choice, confidence }]));
}

const result = (over: Partial<VariationResult> = {}): VariationResult => ({ id: "v", screenshot: "/tmp/v.png", audit: clean, consoleErrors: [], pageErrors: [], unmatchedRequests: [], ...over });

describe("judgeVariation", () => {
  it("passes a clean variation", () => {
    const v = judgeVariation(result({ expect: { content: "data" } }), answers());
    expect(v.verdict).toBe("pass");
    expect(v.findings).toEqual([]);
  });

  it("fails on DOM evidence even when the visual check is fine", () => {
    const v = judgeVariation(result({ audit: { ...clean, viewportWidth: 390, offRight: ["Dashboard", "Refresh"], garbage: ["NaN"], duplicateToasts: ["Internal server error x3"] } }), answers());
    expect(v.verdict).toBe("fail");
    expect(v.findings.map((f) => f.message).join("\n")).toMatch(/past the right edge of a 390px viewport: Dashboard, Refresh[\s\S]*NaN[\s\S]*x3/);
  });

  it("treats low-confidence visual problems as unsure, confident ones as failures", () => {
    expect(judgeVariation(result(), answers({ cut_off: ["yes", 0.64] })).verdict).toBe("unsure");
    expect(judgeVariation(result(), answers({ cut_off: ["yes", 0.76] })).verdict).toBe("fail");
  });

  it("compares the screenshot with the expected state", () => {
    const v = judgeVariation(result({ expect: { content: "empty" } }), answers({ content: ["error", 0.88] }));
    expect(v.verdict).toBe("fail");
    expect(v.findings[0]!.message).toContain("expected content=empty, screenshot shows content=error");
  });

  it("checks custom questions against their expected option", () => {
    const checks = [{ id: "save", question: "Is the Save button greyed out?", options: { yes: "Greyed out", no: "Enabled" }, expect: "yes" }];
    const r = result({ checks });
    expect(Object.keys(buildQuestions(r))).toEqual([...Object.keys(STANDARD_QUESTIONS), "custom_save"]);
    const a = { ...answers(), custom_save: { type: "choice", choice: "no", confidence: 0.91 } };
    const v = judgeVariation(r, a);
    expect(v.verdict).toBe("fail");
    expect(v.findings[0]!.message).toContain('expected "Greyed out", got "Enabled"');
  });

  it("ignores expected 5xx console errors on an error variation but reports fixture gaps", () => {
    const v = judgeVariation(
      result({ expect: { errors: "both" }, consoleErrors: ["Failed to load resource: the server responded with a status of 500"], unmatchedRequests: ["GET /api/v1/me"] }),
      answers({ errors: ["both", 0.9] }),
    );
    expect(v.verdict).toBe("pass");
    expect(v.findings.map((f) => f.source)).toEqual(["fixture"]);
  });

  it("marks runtime crashes and a missing visual answer", () => {
    const v = judgeVariation(result({ pageErrors: ["TypeError: x is undefined"] }), null);
    expect(v.verdict).toBe("fail");
    expect(v.findings.map((f) => f.severity)).toEqual(["fail", "unsure"]);
  });

  it("fails a blank render and warns when no API call was intercepted", () => {
    const v = judgeVariation(result({ finalUrl: "http://x/claw/v3/runs/v3/runs", apiRequests: 0 }), answers({ content: ["blank", 0.8] }));
    expect(v.verdict).toBe("fail");
    const text = v.findings.map((f) => f.message).join("\n");
    expect(text).toContain("no API request was intercepted on http://x/claw/v3/runs/v3/runs");
    expect(text).toContain("the page rendered blank");
  });

  it("flags a theme class that disagrees with the screenshot", () => {
    const v = judgeVariation(result({ audit: { ...clean, dark: true } }), answers({ background: ["light", 0.85] }));
    expect(v.findings.some((f) => f.message.includes("theme class says dark"))).toBe(true);
  });
});

describe("formatReport", () => {
  it("summarises counts and lists findings for failing variations", () => {
    const report = formatReport([
      judgeVariation(result({ id: "ok" }), answers()),
      judgeVariation(result({ id: "bad", audit: { ...clean, garbage: ["undefined"] } }), answers()),
    ]);
    expect(report.split("\n")[0]).toBe("UI variations: 2 checked — 1 fail, 0 unsure, 1 pass.");
    expect(report).toContain("- FAIL bad (/tmp/v.png)");
    expect(report).toContain("placeholder values in visible text: undefined");
  });
});
