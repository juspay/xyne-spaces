/**
 * Correctness of the write-time per-tool summary.
 *
 * Once `toolStats` is the read path, these numbers ARE the dashboard — a wrong
 * count here is not recoverable at read time, so every field is asserted
 * against a hand-built run rather than a round-trip.
 */

import { describe, expect, it } from "vitest";
import {
  DURATION_BUCKETS_MS,
  extractCitedToolCallIds,
  percentileFromBuckets,
  summarizeToolInvocations,
  type ToolStat,
} from "./tool-stats.js";

const SENTINEL = "(no result — tool end event was not received)";

interface InvOpts {
  tool: string;
  id?: string;
  parent?: string;
  args?: unknown;
  result?: string;
  isError?: boolean;
  status?: string;
  durationMs?: number;
}

const inv = (o: InvOpts): Record<string, unknown> => ({
  toolName: o.tool,
  toolCallId: o.id ?? `call_${o.tool}_${Math.round(Math.random() * 1e9)}`,
  ...(o.parent ? { parentToolCallId: o.parent } : {}),
  // `in` rather than `??` so a test can assert on an explicit null/[] args.
  args: "args" in o ? o.args : { query: "x" },
  result: o.result ?? "ok",
  isError: o.isError ?? false,
  status: o.status ?? "completed",
  durationMs: o.durationMs ?? 100,
});

const only = (stats: ToolStat[] | undefined): ToolStat => {
  expect(stats).toBeDefined();
  expect(stats).toHaveLength(1);
  return stats![0]!;
};

describe("summarizeToolInvocations — shape", () => {
  it("returns undefined for a run with no invocations, keeping the column NULL", () => {
    expect(summarizeToolInvocations([], null)).toBeUndefined();
    expect(summarizeToolInvocations(null, null)).toBeUndefined();
    expect(summarizeToolInvocations("not an array", null)).toBeUndefined();
  });

  it("skips malformed entries and entries with no tool name instead of throwing", () => {
    const stats = summarizeToolInvocations([null, "junk", { args: {} }, inv({ tool: "kb-search" })], null);
    expect(only(stats).t).toBe("kb-search");
  });

  it("groups by tool name", () => {
    const stats = summarizeToolInvocations(
      [inv({ tool: "kb-search" }), inv({ tool: "web-search" }), inv({ tool: "kb-search" })],
      null,
    );
    expect(stats?.map((s) => [s.t, s.c])).toEqual([["kb-search", 2], ["web-search", 1]]);
  });
});

describe("dropped end-events", () => {
  it("counts BOTH dropped shapes and excludes them from latency and bytes", () => {
    const stats = only(summarizeToolInvocations([
      inv({ tool: "kb-search", durationMs: 200, result: "abcd" }),
      inv({ tool: "kb-search", status: "running", result: "", durationMs: 0 }),
      inv({ tool: "kb-search", result: SENTINEL, durationMs: 0 }),
    ], null));

    expect(stats.c).toBe(3);
    expect(stats.d).toBe(2);
    expect(stats.ms).toBe(200);
    expect(stats.mx).toBe(200);
    expect(stats.b).toBe(4);
  });

  it("does not treat a genuinely instant call as dropped", () => {
    const stats = only(summarizeToolInvocations([inv({ tool: "todo-write", durationMs: 0 })], null));
    expect(stats.d).toBe(0);
    expect(stats.c).toBe(1);
  });

  it("does not count a dropped row as an error or an empty result", () => {
    const stats = only(summarizeToolInvocations([inv({ tool: "kb-search", result: SENTINEL })], null));
    expect(stats.e).toBe(0);
    expect(stats.z).toBe(0);
  });
});

describe("top-level vs subagent child calls", () => {
  it("separates children by parentToolCallId presence", () => {
    const stats = only(summarizeToolInvocations([
      inv({ tool: "kb-search" }),
      inv({ tool: "kb-search", parent: "call_wrapper_1" }),
      inv({ tool: "kb-search", parent: "call_wrapper_1" }),
    ], null));
    expect(stats.c).toBe(3);
    expect(stats.tl).toBe(1);
  });
});

describe("citation attribution", () => {
  it("counts a call as citeable only when its result carries a token", () => {
    const stats = only(summarizeToolInvocations([
      inv({ tool: "kb-search", id: "call_a", result: "[clf-call_a#1] body" }),
      inv({ tool: "kb-search", id: "call_b", result: "plain body" }),
    ], "answer with no citation"));
    expect(stats.ce).toBe(1);
    expect(stats.ci).toBe(0);
  });

  it("counts a citeable call as cited when the answer references its toolCallId", () => {
    const stats = only(summarizeToolInvocations([
      inv({ tool: "kb-search", id: "call_a", result: "[clf-call_a#1] body" }),
      inv({ tool: "kb-search", id: "call_b", result: "[clf-call_b#1] body" }),
    ], "Revenue rose [clf-call_a#1] this quarter."));
    expect(stats.ce).toBe(2);
    expect(stats.ci).toBe(1);
  });

  it("never counts a non-citeable call as cited, even if the id appears in the answer", () => {
    const stats = only(summarizeToolInvocations(
      [inv({ tool: "sandbox-run", id: "call_a", result: "wrote file" })],
      "see [clf-call_a#1]",
    ));
    expect(stats.ce).toBe(0);
    expect(stats.ci).toBe(0);
  });

  it("KNOWN LIMIT: cross-turn citation is not counted — only this run's answer is visible", () => {
    const stats = only(summarizeToolInvocations(
      [inv({ tool: "kb-search", id: "call_turn1", result: "[clf-call_turn1#1] body" })],
      null, // a LATER turn cites this chunk; that answer does not exist here
    ));
    expect(stats.ce).toBe(1);
    expect(stats.ci).toBe(0);
  });
});

describe("duplicate detection", () => {
  it("flags repeat calls with identical args, not the first occurrence", () => {
    const stats = only(summarizeToolInvocations([
      inv({ tool: "kb-search", args: { q: "revenue" } }),
      inv({ tool: "kb-search", args: { q: "revenue" } }),
      inv({ tool: "kb-search", args: { q: "revenue" } }),
    ], null));
    expect(stats.dup).toBe(2);
  });

  it("treats key order as insignificant", () => {
    const stats = only(summarizeToolInvocations([
      inv({ tool: "kb-search", args: { a: 1, b: 2 } }),
      inv({ tool: "kb-search", args: { b: 2, a: 1 } }),
    ], null));
    expect(stats.dup).toBe(1);
  });

  it("does not flag genuinely different args", () => {
    const stats = only(summarizeToolInvocations([
      inv({ tool: "kb-search", args: { q: "revenue" } }),
      inv({ tool: "kb-search", args: { q: "churn" } }),
    ], null));
    expect(stats.dup).toBe(0);
  });
});

describe("recovery after error", () => {
  it("counts an errored call as recovered when the same tool later succeeds", () => {
    const stats = only(summarizeToolInvocations([
      inv({ tool: "kb-search", isError: true }),
      inv({ tool: "kb-search", isError: false }),
    ], null));
    expect(stats.e).toBe(1);
    expect(stats.rec).toBe(1);
  });

  it("does not count an error that never recovered", () => {
    const stats = only(summarizeToolInvocations([
      inv({ tool: "kb-search", isError: false }),
      inv({ tool: "kb-search", isError: true }),
    ], null));
    expect(stats.rec).toBe(0);
  });

  it("scopes recovery per tool", () => {
    const stats = summarizeToolInvocations([
      inv({ tool: "kb-search", isError: true }),
      inv({ tool: "web-search", isError: false }),
    ], null);
    expect(stats?.find((s) => s.t === "kb-search")?.rec).toBe(0);
  });
});

describe("arg field usage", () => {
  it("counts how many calls supplied each field", () => {
    const stats = only(summarizeToolInvocations([
      inv({ tool: "kb-search", args: { query: "a", limit: 5 } }),
      inv({ tool: "kb-search", args: { query: "b" } }),
    ], null));
    expect(stats.f).toEqual({ query: 2, limit: 1 });
  });

  it("tolerates non-object args, which zero-arg tools persist as []", () => {
    const stats = only(summarizeToolInvocations([
      inv({ tool: "experiment-clock", args: [] }),
      inv({ tool: "experiment-clock", args: null }),
    ], null));
    expect(stats.f).toEqual({});
    expect(stats.c).toBe(2);
  });
});

describe("duration histogram", () => {
  it("places durations in the correct buckets", () => {
    const stats = only(summarizeToolInvocations([
      inv({ tool: "t", durationMs: 10 }),
      inv({ tool: "t", durationMs: 75 }),
      inv({ tool: "t", durationMs: 999999 }),
    ], null));
    expect(stats.h[0]).toBe(1);
    expect(stats.h[1]).toBe(1);
    expect(stats.h[DURATION_BUCKETS_MS.length]).toBe(1);
  });

  it("recovers a percentile from summed buckets", () => {
    const buckets = new Array<number>(DURATION_BUCKETS_MS.length + 1).fill(0);
    buckets[0] = 95;
    buckets[5] = 5;
    expect(percentileFromBuckets(buckets, 0.5)).toBe(DURATION_BUCKETS_MS[0]);
    expect(percentileFromBuckets(buckets, 0.99)).toBe(DURATION_BUCKETS_MS[5]);
  });

  it("returns null rather than 0 when no durations were recorded", () => {
    expect(percentileFromBuckets(new Array<number>(9).fill(0), 0.5)).toBeNull();
  });
});

describe("extractCitedToolCallIds", () => {
  it("extracts every distinct id", () => {
    expect([...extractCitedToolCallIds("a [clf-c1#1] b [clf-c2#4] c [clf-c1#9]")]).toEqual(["c1", "c2"]);
  });

  it("ignores malformed tokens", () => {
    expect(extractCitedToolCallIds("[clf-c1] no chunk index").size).toBe(0);
  });

  it("handles null and token-free text without scanning", () => {
    expect(extractCitedToolCallIds(null).size).toBe(0);
    expect(extractCitedToolCallIds("plain answer").size).toBe(0);
  });
});
