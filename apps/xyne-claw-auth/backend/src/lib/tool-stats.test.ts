import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  DURATION_BUCKETS_MS, HISTOGRAM_SLOTS, errorClassesByTool, extractCitedToolCallIds, isSyntheticInvocation, normalizeError,
  percentileFromBuckets, persistRunStats, runToolNames, summarizeRun, toolStatRows, type ToolStat,
} from "./tool-stats.js";

const SENTINEL = "(no result — tool end event was not received)";

interface InvOpts { tool: string; id?: string; parent?: string; args?: unknown; result?: string; isError?: boolean; status?: string; durationMs?: number }

const inv = (o: InvOpts): Record<string, unknown> => ({
  toolName: o.tool, toolCallId: o.id ?? `call_${o.tool}`, ...(o.parent ? { parentToolCallId: o.parent } : {}),
  args: "args" in o ? o.args : { query: "x" }, result: o.result ?? "ok", isError: o.isError ?? false,
  status: o.status ?? "completed", durationMs: o.durationMs ?? 100,
});

const one = (invocations: unknown[], answer: string | null = null): ToolStat => {
  const { stats } = summarizeRun(invocations, answer);
  expect(stats).toHaveLength(1);
  return stats[0]!;
};

const envelope = (...texts: string[]): string => JSON.stringify({ content: texts.map((text) => ({ type: "text", text })), details: {} });
const emptyBuckets = (): number[] => new Array<number>(HISTOGRAM_SLOTS).fill(0);

describe("summarizeRun", () => {
  it("returns an empty summary for no or malformed invocations", () => {
    for (const input of [[], null]) expect(summarizeRun(input, null)).toEqual({ stats: [], totals: { calls: 0, errors: 0 }, errors: [] });
  });

  it("groups by tool, skips malformed entries and separates subagent child calls", () => {
    const s = summarizeRun([null, "junk", { args: {} }, inv({ tool: "a" }), inv({ tool: "b" }), inv({ tool: "a", isError: true, result: "boom" }), inv({ tool: "a", parent: "w" })], null);
    expect(s.stats.map((t) => [t.t, t.c, t.tl])).toEqual([["a", 3, 2], ["b", 1, 1]]);
    expect(s.totals).toEqual({ calls: 4, errors: 1 });
  });

  it("skips synthetic follow-up calls entirely but keeps a real ask-user-question", () => {
    const followUp = { toolName: "ask-user-question", args: { purpose: "follow_up_suggestions", options: ["a"] }, result: "" };
    expect(isSyntheticInvocation(followUp)).toBe(true);
    expect(isSyntheticInvocation({ toolName: "ask-user-question", args: { questions: [{ q: "which?" }] } })).toBe(false);
    expect(summarizeRun([followUp, inv({ tool: "kb-search" })], null).stats.map((x) => x.t)).toEqual(["kb-search"]);
  });
});

describe("dropped end-events", () => {
  it("counts both dropped shapes and excludes them from latency, bytes, errors and empties", () => {
    const s = one([inv({ tool: "t", durationMs: 200, result: "abcd" }), inv({ tool: "t", status: "running", result: "", durationMs: 0 }), inv({ tool: "t", result: SENTINEL, durationMs: 0, isError: true })]);
    expect(s).toMatchObject({ c: 3, d: 2, ms: 200, mx: 200, b: 4, e: 0, z: 0 });
    expect(one([inv({ tool: "todo-write", durationMs: 0 })])).toMatchObject({ d: 0, c: 1 });
  });
});

describe("citation attribution", () => {
  const cite = (id: string) => inv({ tool: "kb-search", id, result: `[clf-${id}#1] body` });

  it("citeable only when the result carries a token; cited only when the answer references its id", () => {
    const s = one([cite("call_a"), cite("call_b"), inv({ tool: "kb-search", id: "call_c", result: "plain" })], "Revenue rose [clf-call_a#1].");
    expect([s.ce, s.ci]).toEqual([2, 1]);
    expect(one([inv({ tool: "sandbox-run", id: "call_a", result: "wrote file" })], "see [clf-call_a#1]")).toMatchObject({ ce: 0, ci: 0 });
  });

});

describe("duplicates and recovery", () => {
  it("flags repeat calls with identical args regardless of key order, not the first occurrence", () => {
    const dups = (...args: unknown[]) => one(args.map((a) => inv({ tool: "t", args: a }))).dup;
    expect([dups({ q: "r" }, { q: "r" }, { q: "r" }), dups({ a: 1, b: 2 }, { b: 2, a: 1 }), dups({ q: "r" }, { q: "c" })]).toEqual([2, 1, 0]);
  });

  it("recovers an error only when the same tool later succeeds", () => {
    expect(one([inv({ tool: "t", isError: true }), inv({ tool: "t" })])).toMatchObject({ e: 1, rec: 1 });
    expect(one([inv({ tool: "t" }), inv({ tool: "t", isError: true })]).rec).toBe(0);
  });
});

describe("duration histogram", () => {
  it("places durations in the right buckets, up to 300 s plus overflow", () => {
    const s = one([10, 75, 45_000, 299_999, 999_999].map((durationMs) => inv({ tool: "t", durationMs })));
    expect(s.h).toHaveLength(HISTOGRAM_SLOTS);
    expect(DURATION_BUCKETS_MS.at(-1)).toBe(300_000);
    for (const i of [0, 1, DURATION_BUCKETS_MS.indexOf(60_000), DURATION_BUCKETS_MS.indexOf(300_000), DURATION_BUCKETS_MS.length]) expect(s.h[i]).toBe(1);
    expect(one([10.6, 0.4].map((durationMs) => inv({ tool: "t", durationMs }))).ms).toBe(11);
  });
});

describe("percentileFromBuckets", () => {
  const at = (slots: Record<number, number>): number[] => Object.assign(emptyBuckets(), slots);

  it("interpolates inside the bucket holding the rank, starting bucket 0 at 0 ms", () => {
    const mixed = at({ 0: 95, 5: 5 });
    const single = at({ [DURATION_BUCKETS_MS.indexOf(5000)]: 100 });
    const ms = (b: number[], q: number) => percentileFromBuckets(b, q);
    expect([ms(mixed, 0.5).ms, ms(mixed, 0.99).ms, ms(single, 0.5).ms, ms(single, 1).ms, ms(single, 0).ms, ms(at({ 1: 50, 6: 50 }), 0.51).ms]).toEqual([26, 2200, 3750, 5000, 2500, 2550]);
  });

  it("reports the overflow bucket as overflow, never as the last edge, and null without data", () => {
    const over = at({ 0: 50, [HISTOGRAM_SLOTS - 1]: 50 });
    expect(percentileFromBuckets(over, 0.95)).toEqual({ ms: null, overflow: true });
    expect(percentileFromBuckets(over, 0.5).ms).toBe(DURATION_BUCKETS_MS[0]);
    expect(percentileFromBuckets(emptyBuckets(), 0.5)).toEqual({ ms: null, overflow: false });
  });
});

describe("error rows", () => {
  it("emits one row per errored, non-dropped call with its position", () => {
    const s = summarizeRun([inv({ tool: "a" }), inv({ tool: "a", isError: true, result: envelope("Search error: Spaces API 500: fetch failed") }), inv({ tool: "a", isError: true, result: SENTINEL })], null);
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toMatchObject({ tool: "a", pos: 2, notFound: false, sample: "Search error: Spaces API 500: fetch failed" });
    const nf = one([inv({ tool: "w", isError: true, result: envelope("Tool w not found") }), inv({ tool: "w" })]);
    expect([nf.e, nf.nf]).toEqual([1, 1]);
  });
});

describe("normalizeError", () => {
  const spacesErr = (status: number, error: string, ts = "2026-08-25T03:44:38.241Z") =>
    envelope(`Search error: Spaces API ${status}: {"success":false,"error":"${error}","timestamp":"${ts}"}`);

  it("unwraps the envelope ignoring skill parts, and groups the same failure across ids and timestamps", () => {
    const body = 'Search error: Spaces API 500: {"success":false,"error":"Vespa search error: fetch failed"}';
    expect(normalizeError(envelope(body, "\n\n---\n**[Skill Injected: Spaces Citations]**")).sample).toBe(body);
    const a = normalizeError(spacesErr(400, "Invalid channel IDs: awkfix"));
    expect(a.errorClass).toBe(normalizeError(spacesErr(400, "Invalid channel IDs: awkfix", "2026-08-25T03:44:38.243Z")).errorClass);
    expect(a.errorClass).toBe("search error: spaces api #: invalid channel ids: awkfix");
    expect(normalizeError(envelope(body)).errorClass).toBe("search error: spaces api #: vespa search error: fetch failed");
  });

  it.each([
    ["GET https://api.example.com/v1/x?id=1 failed for ops@example.com run cmsrllazx000fibolqba260wt hash deadbeefcafe1234", "get <url> failed for <email> run <id> hash <id>"],
    ["Validation failed: id 98d1e838-fb7d-4514-af4d-64295ca3869c", "validation failed: id <uuid>"],
    ["Can't find user 'bob'", "can't find user <str>"],
    ["", "(empty error)"],
  ])("masks %j", (raw, cls) => {
    expect(normalizeError(raw).errorClass).toBe(cls);
  });

  it("flags not-found from the unwrapped text only, and collapses whitespace, strips NUL and caps sample at 400 and class at 160", () => {
    expect(normalizeError(envelope("Tool todos not found")).notFound).toBe(true);
    expect(normalizeError(envelope("Path not found: /x/data")).notFound).toBe(false);
    const n = normalizeError(`a\u0000   b\n\n${"x".repeat(1000)}`);
    expect([n.sample.startsWith("a b "), n.sample.length, n.errorClass.length <= 160]).toEqual([true, 400, true]);
  });
});

describe("persistRunStats", () => {
  const run = { id: "run1", orgId: "o1", userId: "u1", agentSlug: "xyne", completedAt: new Date("2026-10-01T00:01:00Z") };
  const mockTx = ({ created = ["run1"], updated = 0 }: { created?: string[]; updated?: number } = {}) => {
    const tx = {
      agentRunStats: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createManyAndReturn: vi.fn().mockResolvedValue(created.map((runId) => ({ runId }))),
        updateMany: vi.fn().mockResolvedValue({ count: updated }),
      },
      agentRunToolStats: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };
    return { tx, asTx: tx as unknown as Prisma.TransactionClient };
  };
  const summary = summarizeRun([inv({ tool: "a", isError: true, result: "boom" }), inv({ tool: "b" })], null);
  const none = { statsRows: 0, toolRows: 0, errorCalls: 0 };

  it("inserts the run row, then replaces its tool rows", async () => {
    const { tx, asTx } = mockTx();
    expect(await persistRunStats(asTx, [{ run, summary, llmCalls: [{ m: "x" }], toolsUsed: ["c"] }])).toEqual({ statsRows: 1, toolRows: 2, errorCalls: 1 });
    expect(tx.agentRunStats.createManyAndReturn.mock.calls[0]![0]).toMatchObject({
      skipDuplicates: true,
      data: [{ runId: "run1", toolCalls: 2, toolErrors: 1, toolNames: ["a", "b", "c"], llmCallCount: 1, llmCalls: [{ m: "x" }] }],
    });
    expect(tx.agentRunStats.updateMany).not.toHaveBeenCalled();
    expect(tx.agentRunToolStats.deleteMany).toHaveBeenCalledWith({ where: { runId: { in: ["run1"] } } });
    const rows = tx.agentRunToolStats.createMany.mock.calls[0]![0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ runId: "run1", tool: "a", orgId: "o1", completedAt: run.completedAt, calls: 1, errors: 1, errorClasses: [{ class: "boom", count: 1 }] });
    expect(rows[1]).toMatchObject({ tool: "b", errors: 0, errorClasses: Prisma.DbNull });
  });

  it("moves a stored row only forward, keeping llm fields the item lacks, and replaces tool rows only then", async () => {
    const newer = mockTx({ created: [], updated: 0 });
    expect(await persistRunStats(newer.asTx, [{ run, summary }])).toEqual(none);
    expect(newer.tx.agentRunToolStats.deleteMany).not.toHaveBeenCalled();
    const older = mockTx({ created: [], updated: 1 });
    expect(await persistRunStats(older.asTx, [{ run, summary }])).toMatchObject({ statsRows: 1, toolRows: 2 });
    const { where, data } = older.tx.agentRunStats.updateMany.mock.calls[0]![0];
    expect(where).toEqual({ runId: "run1", completedAt: { lte: run.completedAt } });
    expect(data).not.toHaveProperty("llmCalls");
  });

  it("keeps no rows for an orphan-closed run: only its run row is deleted", async () => {
    const { tx, asTx } = mockTx();
    expect(await persistRunStats(asTx, [{ run: { ...run, error: "interrupted (orphaned run)" }, summary }])).toEqual(none);
    expect(tx.agentRunStats.deleteMany).toHaveBeenCalledWith({ where: { runId: { in: ["run1"] } } });
    expect(tx.agentRunStats.createManyAndReturn).not.toHaveBeenCalled();
  });
});

describe("tool rows", () => {
  it("groups a tool's errors by class in first-seen order, counting each and keeping the first sample", () => {
    const e = (pos: number, errorClass: string, sample = errorClass, notFound = false) => ({ tool: "a", pos, errorClass, sample, notFound });
    expect(errorClassesByTool([e(4, "timeout", "timeout 2"), e(1, "timeout", "timeout 1"), e(2, "nf", "nf", true), { ...e(3, "boom"), tool: "b" }]).get("a")).toEqual([
      { class: "timeout", count: 2, sample: "timeout 1", notFound: false },
      { class: "nf", count: 1, sample: "nf", notFound: true },
    ]);
  });

  it("maps counters to columns, clamps to int4 and truncates the tool name to 200 chars", () => {
    const s = summarizeRun([inv({ tool: "a".repeat(300), durationMs: 120 }), inv({ tool: "a".repeat(300), isError: true, result: "x" })], null);
    s.stats[0]!.ms = 5e12;
    const [row] = toolStatRows({ run: { id: "r", orgId: "o", userId: "u", agentSlug: "g", completedAt: new Date(0) }, summary: s });
    expect(row).toMatchObject({ runId: "r", calls: 2, errors: 1, totalMs: 2_147_483_647, completedAt: new Date(0) });
    expect(row!.tool).toHaveLength(200);
  });
});

describe("tool name and citation helpers", () => {
  it("merges called tools with toolsUsed, deduplicated and sorted, tolerating an empty run or missing list", () => {
    const s = summarizeRun([inv({ tool: "b" }), inv({ tool: "a" }), inv({ tool: "a" })], null);
    expect(runToolNames(s, ["c", "a", ""])).toEqual(["a", "b", "c"]);
    expect(runToolNames(summarizeRun([], null), null)).toEqual([]);
  });

  it("extracts every distinct id and ignores malformed, null and token-free text", () => {
    expect([...extractCitedToolCallIds("a [clf-c1#1] b [clf-c2#4] c [clf-c1#9]")]).toEqual(["c1", "c2"]);
    for (const text of ["[clf-c1] no chunk index", null, "plain answer"]) expect(extractCitedToolCallIds(text).size).toBe(0);
  });
});
