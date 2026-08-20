/**
 * Per-LLM-call recording semantics.
 *
 * The latching behaviour is the part worth pinning: compaction and retry are
 * observed as separate events before the call they describe finishes, so a
 * marker landing on the wrong call would silently invert the exact correlation
 * this data exists to measure.
 */
import { describe, expect, it } from "vitest";
import {
  LlmTurnRecorder,
  MAX_LLM_CALLS,
  contextTokens,
  tokensPerSecond,
  type LlmCallStat,
} from "../src/llm-turn-stats.js";

const call = (over: Partial<Parameters<LlmTurnRecorder["record"]>[0]> = {}) => ({
  index: 1,
  ttftMs: 400,
  decodeMs: 1000,
  usage: { input: 500, output: 200, cacheRead: 12000, cacheWrite: 0 },
  ...over,
});

describe("recording", () => {
  it("returns undefined when nothing was recorded, keeping the column NULL", () => {
    expect(new LlmTurnRecorder().snapshot()).toBeUndefined();
  });

  it("captures ttft, decode and each token bucket separately", () => {
    const r = new LlmTurnRecorder();
    r.record(call());
    const [c] = r.snapshot()!;
    expect(c).toMatchObject({ i: 1, ttft: 400, dec: 1000, in: 500, out: 200, cr: 12000, cw: 0 });
  });

  it("keeps a null ttft rather than coercing it to zero when no delta arrived", () => {
    const r = new LlmTurnRecorder();
    r.record(call({ ttftMs: null }));
    expect(r.snapshot()![0]!.ttft).toBeNull();
  });

  it("defaults missing usage to zeros instead of dropping the call", () => {
    const r = new LlmTurnRecorder();
    r.record(call({ usage: undefined }));
    expect(r.snapshot()![0]).toMatchObject({ in: 0, out: 0, cr: 0, cw: 0 });
  });

  it("records model and provider so a mid-run fallback is attributable", () => {
    const r = new LlmTurnRecorder();
    r.record(call({ model: "private-large", provider: "spaces" }));
    r.record(call({ index: 2, model: "gpt-5.5", provider: "codex" }));
    expect(r.snapshot()!.map((c) => [c.m, c.p])).toEqual([
      ["private-large", "spaces"],
      ["gpt-5.5", "codex"],
    ]);
  });

  it("omits optional keys entirely when absent, keeping the stored row small", () => {
    const r = new LlmTurnRecorder();
    r.record(call({ streamChars: 0 }));
    const c = r.snapshot()![0]!;
    expect("ch" in c).toBe(false);
    expect("cmp" in c).toBe(false);
    expect("sa" in c).toBe(false);
  });
});

describe("compaction and retry latching", () => {
  it("applies a compaction marker to the NEXT call, not the one already recorded", () => {
    const r = new LlmTurnRecorder();
    r.record(call({ index: 1 }));
    r.markCompaction();
    r.record(call({ index: 2 }));
    r.record(call({ index: 3 }));
    expect(r.snapshot()!.map((c) => c.cmp)).toEqual([undefined, true, undefined]);
  });

  it("applies a retry marker to the next call only", () => {
    const r = new LlmTurnRecorder();
    r.markRetry();
    r.record(call({ index: 1 }));
    r.record(call({ index: 2 }));
    expect(r.snapshot()!.map((c) => c.rty)).toEqual([true, undefined]);
  });

  it("can carry both markers on one call", () => {
    const r = new LlmTurnRecorder();
    r.markCompaction();
    r.markRetry();
    r.record(call());
    expect(r.snapshot()![0]).toMatchObject({ cmp: true, rty: true });
  });

  it("does not leak a latched marker past the cap", () => {
    const r = new LlmTurnRecorder();
    for (let i = 0; i < MAX_LLM_CALLS; i++) r.record(call({ index: i + 1 }));
    r.markCompaction();
    r.record(call({ index: MAX_LLM_CALLS + 1 }));
    r.record(call({ index: MAX_LLM_CALLS + 2 }));
    expect(r.snapshot()).toHaveLength(MAX_LLM_CALLS);
    expect(r.droppedCount()).toBe(2);
  });
});

describe("subagent merge", () => {
  it("absorbs child calls tagged with their subagent", () => {
    const r = new LlmTurnRecorder();
    r.record(call({ index: 1 }));
    const child: LlmCallStat[] = [{ i: 1, ttft: 100, dec: 200, in: 10, out: 5, cr: 0, cw: 0, sa: "spaces" }];
    r.absorb(child);
    const snap = r.snapshot()!;
    expect(snap).toHaveLength(2);
    expect(snap[1]!.sa).toBe("spaces");
  });

  it("leaves parent-only analysis possible by tagging only child calls", () => {
    const r = new LlmTurnRecorder();
    r.record(call({ index: 1 }));
    r.absorb([{ i: 1, ttft: 1, dec: 1, in: 0, out: 0, cr: 0, cw: 0, sa: "grafana" }]);
    expect(r.snapshot()!.filter((c) => !c.sa)).toHaveLength(1);
  });

  it("tolerates an undefined child series", () => {
    const r = new LlmTurnRecorder();
    r.absorb(undefined);
    expect(r.snapshot()).toBeUndefined();
  });

  it("respects the cap when absorbing", () => {
    const r = new LlmTurnRecorder();
    for (let i = 0; i < MAX_LLM_CALLS; i++) r.record(call({ index: i + 1 }));
    r.absorb([{ i: 1, ttft: 1, dec: 1, in: 0, out: 0, cr: 0, cw: 0, sa: "spaces" }]);
    expect(r.snapshot()).toHaveLength(MAX_LLM_CALLS);
    expect(r.droppedCount()).toBe(1);
  });
});

describe("derived axes", () => {
  it("counts cached tokens as part of the prompt, which is the whole point", () => {
    const c: LlmCallStat = { i: 1, ttft: 0, dec: 1, in: 500, out: 10, cr: 12000, cw: 300 };
    expect(contextTokens(c)).toBe(12800);
    // Using `in` alone would report 500 — off by the entire cached prefix.
    expect(contextTokens(c)).not.toBe(c.in);
  });

  it("computes tokens per second from decode time", () => {
    expect(tokensPerSecond({ i: 1, ttft: 0, dec: 2000, in: 0, out: 300, cr: 0, cw: 0 })).toBe(150);
  });

  it("returns null rather than dividing by zero", () => {
    expect(tokensPerSecond({ i: 1, ttft: 0, dec: 0, in: 0, out: 300, cr: 0, cw: 0 })).toBeNull();
    expect(tokensPerSecond({ i: 1, ttft: 0, dec: 1000, in: 0, out: 0, cr: 0, cw: 0 })).toBeNull();
  });
});
