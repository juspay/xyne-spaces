import { describe, expect, it } from "vitest";
import { LlmTurnRecorder, MAX_LLM_CALLS, mergeLlmCallSeries, type LlmCallStat } from "../src/llm-turn-stats.js";

const call = (over: Partial<Parameters<LlmTurnRecorder["record"]>[0]> = {}) => ({
  index: 1,
  ttftMs: 400,
  decodeMs: 1000,
  usage: { input: 500, output: 200, cacheRead: 12000, cacheWrite: 0 },
  ...over,
});
const stat = (i: number, sa?: string): LlmCallStat => ({ i, ttft: 1, dec: 1, in: 0, out: 0, cr: 0, cw: 0, ...(sa ? { sa } : {}) });

describe("recording", () => {
  it("returns undefined when nothing was recorded", () => {
    expect(new LlmTurnRecorder().snapshot()).toBeUndefined();
  });

  it("captures timings and token buckets, keeping a null ttft and defaulting missing usage to zeros", () => {
    const r = new LlmTurnRecorder();
    r.record(call());
    r.record(call({ index: 2, ttftMs: null, usage: undefined }));
    const [a, b] = r.snapshot()!;
    expect(a).toMatchObject({ i: 1, ttft: 400, dec: 1000, in: 500, out: 200, cr: 12000, cw: 0 });
    expect(b).toMatchObject({ ttft: null, in: 0, out: 0, cr: 0, cw: 0 });
  });

  it("records model and provider, and omits absent optional keys", () => {
    const r = new LlmTurnRecorder();
    r.record(call({ model: "private-large", provider: "spaces", streamChars: 0 }));
    const c = r.snapshot()![0]!;
    expect([c.m, c.p]).toEqual(["private-large", "spaces"]);
    expect(Object.keys(c).filter((k) => ["ch", "cmp", "rty", "sa"].includes(k))).toEqual([]);
  });
});

describe("compaction and retry latching", () => {
  it("applies each marker to the next call only", () => {
    const r = new LlmTurnRecorder();
    r.record(call({ index: 1 }));
    r.markCompaction();
    r.markRetry();
    r.record(call({ index: 2 }));
    r.record(call({ index: 3 }));
    expect(r.snapshot()!.map((c) => [c.cmp, c.rty])).toEqual([[undefined, undefined], [true, true], [undefined, undefined]]);
  });

  it("drops calls past the cap without leaking a latched marker", () => {
    const r = new LlmTurnRecorder();
    for (let i = 0; i < MAX_LLM_CALLS; i++) r.record(call({ index: i + 1 }));
    r.markCompaction();
    r.record(call({ index: MAX_LLM_CALLS + 1 }));
    expect(r.snapshot()).toHaveLength(MAX_LLM_CALLS);
    expect(r.snapshot()!.some((c) => c.cmp)).toBe(false);
  });
});

describe("mergeLlmCallSeries", () => {
  it("caps the concatenation at MAX_LLM_CALLS, keeping parent calls first", () => {
    const parent = Array.from({ length: 150 }, (_, i) => stat(i + 1));
    const nested = Array.from({ length: 100 }, (_, i) => stat(i + 1, "spaces"));
    const { calls, dropped } = mergeLlmCallSeries(parent, nested);
    expect(calls).toHaveLength(MAX_LLM_CALLS);
    expect(dropped).toBe(50);
    expect(calls.slice(0, 150).every((c) => !c.sa)).toBe(true);
  });

  it("passes a short series through and tolerates undefined parts", () => {
    expect(mergeLlmCallSeries(undefined, [stat(1, "grafana")], undefined)).toEqual({ calls: [stat(1, "grafana")], dropped: 0 });
  });
});
