import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const scoreItems = vi.fn();
vi.mock("../src/jev.js", () => ({
  jevEnabled: () => true,
  jevThreshold: (_n: string, fallback: number) => fallback,
  jevScoreItems: (...args: unknown[]) => scoreItems(...args),
}));

const { buildJevCompaction } = await import("../src/jev-compaction.js");

function call(id: string, name: string, args: Record<string, unknown> = {}) {
  return { type: "toolCall", id, name, arguments: args };
}
function assistant(text: string, calls: unknown[] = []) {
  return { role: "assistant", content: [{ type: "text", text }, ...calls] };
}
function result(toolCallId: string, toolName: string, text: string, isError = false) {
  return { role: "toolResult", toolCallId, toolName, isError, content: [{ type: "text", text }] };
}
function user(text: string) {
  return { role: "user", content: text };
}

/** Score every call the same, for both the call and result questions. */
function scoreAll(v: number) {
  scoreItems.mockImplementation(async (_state: string, items: { id: string }[]) =>
    new Map(items.map((i) => [i.id, v])),
  );
}

beforeEach(() => {
  scoreItems.mockReset();
  process.env["JEV_COMPACTION_PRESERVE_RECENT"] = "1";
});
afterEach(() => {
  delete process.env["JEV_COMPACTION_PRESERVE_RECENT"];
  delete process.env["JEV_COMPACTION_MIN_REDUCTION"];
});

const BULK = "x".repeat(8000);

describe("jev compaction selection", () => {
  it("drops a low-scoring call and its result, and never orphans a result", async () => {
    scoreAll(0.1);
    const out = await buildJevCompaction([
      user("find the bug"),
      assistant("looking", [call("c1", "search_code", { q: "auth" })]),
      result("c1", "search_code", BULK),
      user("thanks"),
    ]);
    expect(out).not.toBeNull();
    expect(out!.droppedCalls).toBe(1);
    expect(out!.summary).not.toContain("search_code result");
    expect(out!.summary).not.toContain(BULK);
    expect(out!.summary).toContain("find the bug");
  });

  it("keeps a high-scoring call verbatim while dropping a low-scoring one", async () => {
    // Per-call scores: c_keep matters, c_junk does not. Dropping the bulky junk
    // result is what produces the reduction the size guard requires.
    scoreItems.mockImplementation(async (_state: string, items: { id: string }[]) =>
      new Map(items.map((i) => [i.id, i.id === "c_keep" ? 0.9 : 0.05])),
    );
    const out = await buildJevCompaction([
      user("find the bug"),
      assistant("junk", [call("c_junk", "search_code", { q: "noise" })]),
      result("c_junk", "search_code", BULK),
      assistant("looking", [call("c_keep", "read_file", { path: "auth.ts" })]),
      result("c_keep", "read_file", "line 42: bad auth"),
      user("thanks"),
    ]);
    expect(out).not.toBeNull();
    expect(out!.keptCalls).toBe(1);
    expect(out!.droppedCalls).toBe(1);
    expect(out!.summary).toContain("line 42: bad auth");
    expect(out!.summary).not.toContain(BULK);
    expect(out!.charsAfter).toBeLessThan(out!.charsBefore);
  });

  it("never scores pinned calls — first message and the recent tail survive", async () => {
    scoreAll(0.0);
    const out = await buildJevCompaction([
      assistant("opening", [call("first", "spaces-search", {})]),
      user("more"),
      assistant("recent", [call("last", "spaces-messages", {})]),
      result("last", "spaces-messages", "KEEP-ME"),
    ]);
    // Only the middle is scorable; both ends are pinned, so nothing to score.
    expect(out).toBeNull();
    expect(scoreItems).not.toHaveBeenCalled();
  });

  it("refuses to commit when selection does not shrink the window", async () => {
    scoreAll(1.0);
    process.env["JEV_COMPACTION_MIN_REDUCTION"] = "0.9";
    const out = await buildJevCompaction([
      user("go"),
      assistant("a", [call("c1", "t", {})]),
      result("c1", "t", BULK),
      user("end"),
    ]);
    expect(out).toBeNull();
  });

  it("falls back when scoring is unavailable", async () => {
    scoreItems.mockResolvedValue(null);
    const out = await buildJevCompaction([
      user("go"),
      assistant("a", [call("c1", "t", {})]),
      result("c1", "t", BULK),
      user("end"),
    ]);
    expect(out).toBeNull();
  });

  it("caps how many calls are scored and drops the overflow", async () => {
    process.env["JEV_COMPACTION_MAX_CALLS"] = "2";
    scoreAll(0.9);
    const msgs: unknown[] = [user("go")];
    for (let i = 0; i < 5; i += 1) {
      msgs.push(assistant(`step ${i}`, [call(`c${i}`, "t", { i })]));
      msgs.push(result(`c${i}`, "t", BULK));
    }
    msgs.push(user("end"));
    const out = await buildJevCompaction(msgs);
    delete process.env["JEV_COMPACTION_MAX_CALLS"];
    expect(out).not.toBeNull();
    expect(out!.scoredCalls).toBe(2);
    expect(out!.unscoredCalls).toBeGreaterThan(0);
  });
});
