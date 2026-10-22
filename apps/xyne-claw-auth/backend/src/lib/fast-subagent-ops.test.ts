import { describe, expect, it } from "vitest";
import { aggregateCalls, detectDrift, fastSubagentCallRows, hourBucket, reviewSampleRows, type CallRow } from "./fast-subagent-ops.js";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const RUN = { id: "run1", orgId: "org1", agentSlug: "architect", completedAt: new Date(NOW) };

const wrapper = (name: string, fastSubagent: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  toolName: name,
  toolCallId: `call-${name}`,
  durationMs: 4200,
  isError: false,
  debug: { fastSubagent },
  ...extra,
});

describe("rows from a finished run", () => {
  const invocations = [
    wrapper("log-triage", {
      fast: true,
      model: "open-fast",
      tokensIn: 1200,
      tokensOut: 300,
      turns: 3,
      fallbacks: 1,
      xor: { calls: 1, items: 50, answers: 150, unsure: 12, unavailable: 2, cached: 5, quotaBlocked: 0 },
      review: [{ item: "ERROR db", questionId: "failure", question: "Real failure?", value: true, confidence: 0.94 }],
    }),
    wrapper("ui-tester", { fast: false, model: "open-fast", tokensIn: 900, tokensOut: 200, turns: 2, fallbacks: 0, xor: { items: 8, answers: 56, unsure: 3 } }),
    { toolName: "xor-decide", toolCallId: "inner", parentToolCallId: "call-log-triage", debug: { fastSubagent: { fast: true } } },
    { toolName: "spaces", toolCallId: "c9", durationMs: 10, isError: false },
  ];

  it("keeps only top-level fast subagent wrappers", () => {
    const rows = fastSubagentCallRows(RUN, invocations);
    expect(rows.map((r) => r.subagentName)).toEqual(["log-triage", "ui-tester"]);
    expect(rows[0]).toMatchObject({ runId: "run1", orgId: "org1", agentSlug: "architect", durationMs: 4200, fast: true, model: "open-fast", tokensIn: 1200, fallbacks: 1, xorItems: 50, xorAnswers: 150, xorUnsure: 12, xorUnavailable: 2, xorCached: 5 });
    expect(rows[1]).toMatchObject({ fast: false, xorCalls: 0, xorUnsure: 3 });
  });

  it("turns sampled confident answers into review rows", () => {
    expect(reviewSampleRows(RUN, invocations)).toEqual([
      { orgId: "org1", subagentName: "log-triage", runId: "run1", item: "ERROR db", questionId: "failure", question: "Real failure?", value: "true", confidence: 0.94 },
    ]);
  });
});

const call = (name: string, hoursAgo: number, answers: number, unsure: number, extra: Partial<CallRow> = {}): CallRow => ({
  subagentName: name,
  completedAt: new Date(NOW - hoursAgo * 3_600_000),
  durationMs: 1000,
  isError: false,
  fast: true,
  model: "open-fast",
  tokensIn: 100,
  tokensOut: 50,
  fallbacks: 0,
  xorCalls: 1,
  xorItems: answers,
  xorAnswers: answers,
  xorUnsure: unsure,
  xorUnavailable: 0,
  xorCached: 0,
  quotaBlocked: 0,
  ...extra,
});

describe("dashboard rollup", () => {
  it("aggregates per subagent with rates, percentiles and a daily series", () => {
    const rows = [call("log-triage", 1, 100, 10, { durationMs: 900 }), call("log-triage", 30, 100, 20, { durationMs: 3000, fallbacks: 2, xorCached: 25 }), call("ui-tester", 2, 10, 1, { fast: false })];
    const [lt, ui] = aggregateCalls(rows, 7, NOW);
    expect(lt).toMatchObject({ subagentName: "log-triage", calls: 2, p50Ms: 3000, unsureRate: 15, cacheHitRate: 12.5, escalations: 2, tokensOffloaded: 300 });
    expect(lt!.daily).toHaveLength(7);
    expect(lt!.daily.at(-1)).toMatchObject({ calls: 1, unsureRate: 10 });
    expect(ui).toMatchObject({ subagentName: "ui-tester", fast: false, calls: 1 });
  });
});

describe("drift detection", () => {
  const stable = Array.from({ length: 8 }, (_, d) => call("log-triage", 24 * d + 2, 100, 5));

  it("fires when the unsure rate jumps in the last 24h (synthetic drift)", () => {
    const drifted = [...stable.slice(1), call("log-triage", 1, 100, 40), call("log-triage", 3, 100, 35)];
    const alerts = detectDrift(drifted, [], NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ subagentName: "log-triage", kind: "unsure_rate", baseline: 5, current: 37.5, samples: 200 });
    expect(alerts[0]!.message).toContain("up from 5%");
  });

  it("stays quiet on a stable subagent or too little data", () => {
    expect(detectDrift(stable, [], NOW)).toEqual([]);
    expect(detectDrift([call("x", 1, 10, 9), call("x", 48, 10, 0)], [], NOW)).toEqual([]);
  });

  it("fires on xor outages and on reviewers marking confident answers wrong", () => {
    const outage = [...stable.slice(1), call("log-triage", 1, 100, 5, { xorUnavailable: 30 })];
    expect(detectDrift(outage, [], NOW).map((a) => a.kind)).toEqual(["unavailable"]);
    const reviews = Array.from({ length: 12 }, (_, i) => ({ subagentName: "ui-tester", verdict: i < 3 ? "wrong" : "correct", reviewedAt: new Date(NOW - 3_600_000) }));
    expect(detectDrift([], reviews, NOW)).toEqual([expect.objectContaining({ subagentName: "ui-tester", kind: "confident_wrong", current: 25, samples: 12 })]);
  });

  it("buckets alerts by hour so every pod inserts the same key", () => {
    expect(hourBucket(NOW + 59 * 60_000)).toBe("2026-10-23T12:00:00.000Z");
  });
});
