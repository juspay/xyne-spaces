import { describe, expect, it } from "vitest";
import { pinRunOptimizations } from "../src/optimizations.js";
import { verifyResponse, type ResponseVerdict } from "../src/verify-response.js";
import { buildPrecheckQuestions, requirementLines, scorePrecheck } from "../src/verify-prefilter.js";
import type { JevAnswer } from "../src/jev.js";

const input = {
  task: "How many open PRs are there?",
  evidenceDigest: '[bb] {"open_pr_count":27}',
  draft: "There are 27 open PRs.",
};

const noul = (v: number): JevAnswer => ({ type: "noul", noul: v });

function inRun<T>(opts: string, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      pinRunOptimizations(opts);
      fn().then(resolve, reject);
    });
  });
}

function fakeLlm(result: ResponseVerdict | null) {
  const calls: unknown[] = [];
  return { calls, llm: async (i: unknown) => { calls.push(i); return result; } };
}

describe("requirementLines", () => {
  it("strips bullets and numbering and drops blank lines", () => {
    expect(requirementLines("- must link the dashboard\n\n2) must name the owner\n• cite the alert id")).toEqual([
      "must link the dashboard",
      "must name the owner",
      "cite the alert id",
    ]);
  });
});

describe("scorePrecheck", () => {
  it("takes the worst of the fact questions and the weakest requirement", () => {
    const pre = scorePrecheck(
      { contradicted: noul(0.1), fabricated_list: noul(0.2), req_0: noul(0.9), req_1: noul(0.3) },
      "link the dashboard\nname the owner",
    );
    expect(pre?.factRisk).toBe(0.2);
    expect(pre?.weakestRequirement).toEqual({ text: "name the owner", score: 0.3 });
    expect(pre?.risk).toBeCloseTo(0.7);
  });

  it("returns null when an answer is missing", () => {
    expect(scorePrecheck({ contradicted: noul(0.1) }, undefined)).toBeNull();
    expect(scorePrecheck({ contradicted: noul(0.1), fabricated_list: noul(0.1) }, "one rule")).toBeNull();
  });

  it("asks one question per requirement", () => {
    expect(Object.keys(buildPrecheckQuestions("a\nb"))).toEqual(["contradicted", "fabricated_list", "req_0", "req_1"]);
  });
});

describe("verifyResponse with the Jev pre-check", () => {
  it("delivers a draft Jev is confident about without calling the LLM", async () => {
    const { calls, llm } = fakeLlm({ ok: false, errors: [{ claim: "x", check: "y", found: "z" }] });
    const ask = async () => ({ contradicted: noul(0.05), fabricated_list: noul(0.1) });
    const verdict = await inRun("none,+jev_verify_prefilter", () => verifyResponse(input, { ask, llm }));
    expect(verdict.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("sends an uncertain draft to the LLM and returns its verdict", async () => {
    const reject = { ok: false, errors: [{ claim: "58 PRs", check: "count", found: "27" }] };
    const { calls, llm } = fakeLlm(reject);
    const ask = async () => ({ contradicted: noul(0.5), fabricated_list: noul(0.1) });
    const verdict = await inRun("none,+jev_verify_prefilter", () => verifyResponse(input, { ask, llm }));
    expect(calls).toHaveLength(1);
    expect(verdict).toEqual(reject);
  });

  it("sends the draft back when the LLM is unavailable and Jev's risk is high", async () => {
    const { llm } = fakeLlm(null);
    const ask = async () => ({ contradicted: noul(0.2), fabricated_list: noul(0.1), req_0: noul(0.1) });
    const verdict = await inRun("none,+jev_verify_prefilter", () =>
      verifyResponse({ ...input, criteria: "- must link the dashboard" }, { ask, llm }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.errors[0]).toMatchObject({ claim: "must link the dashboard", check: "delivery requirement" });
  });

  it("still passes when the LLM is unavailable and Jev's risk is moderate", async () => {
    const { llm } = fakeLlm(null);
    const ask = async () => ({ contradicted: noul(0.4), fabricated_list: noul(0.1) });
    const verdict = await inRun("none,+jev_verify_prefilter", () => verifyResponse(input, { ask, llm }));
    expect(verdict.ok).toBe(true);
  });

  it("falls back to the LLM alone when Jev is unavailable", async () => {
    const reject = { ok: false, errors: [{ claim: "a", check: "b", found: "c" }] };
    const { calls, llm } = fakeLlm(reject);
    const verdict = await inRun("none,+jev_verify_prefilter", () => verifyResponse(input, { ask: async () => null, llm }));
    expect(calls).toHaveLength(1);
    expect(verdict).toEqual(reject);
  });

  it("leaves today's behaviour unchanged when the switch is off", async () => {
    let asked = 0;
    const { calls, llm } = fakeLlm(null);
    const ask = async () => { asked += 1; return { contradicted: noul(0.9), fabricated_list: noul(0.9) }; };
    const verdict = await inRun("none", () => verifyResponse(input, { ask, llm }));
    expect(asked).toBe(0);
    expect(calls).toHaveLength(1);
    expect(verdict.ok).toBe(true);
  });
});
