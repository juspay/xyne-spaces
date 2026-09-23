import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectItems, siftToolResult, splitResultItems } from "../src/result-sift.js";
import { promoteIfOversized } from "../src/tool-output.js";
import { pinRunOptimizations } from "../src/optimizations.js";
import { pinRunTask } from "../src/run-context.js";

const ENV = ["JEV_API_KEY", "JEV_URL", "JUDGE_BACKEND", "JUDGE_SHADOW", "XYNE_OPT_ALL", "XYNE_OPT_JEV_RESULT_SIFT"];

const hit = (n: number, text: string): string =>
  `${n}. [message] ${text}\n   conversationId: conv-${n} · 12/9/2026, 10:0${n % 10}:00 am\n   ${"context ".repeat(40)}`;

function searchResult(relevant: number[], total = 20): string {
  const blocks = Array.from({ length: total }, (_, i) =>
    hit(i + 1, relevant.includes(i + 1) ? "Aravind: compaction is dropping tool results again" : "lunch plans and parking slots"),
  );
  return `Found ${total} result(s):\n\n${blocks.join("\n\n")}\n\n[Showing 1-${total} of 300. More results available — call again with offset=${total}.]`;
}

function jevReplyFor(relevantText: string) {
  return async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as { questions: Record<string, { instructions: string }> };
    const answers = Object.fromEntries(
      Object.entries(body.questions).map(([id, q]) => [id, { type: "noul", noul: q.instructions.includes(relevantText) ? 0.92 : 0.04 }]),
    );
    return new Response(JSON.stringify({ answers }), { status: 200 });
  };
}

describe("splitResultItems", () => {
  it("splits blank-line-separated search hits and keeps the header and pagination footer apart", () => {
    const split = splitResultItems(searchResult([], 12));
    expect(split?.items).toHaveLength(12);
    expect(split?.head).toBe("Found 12 result(s):");
    expect(split?.tail.startsWith("[Showing 1-12 of 300")).toBe(true);
  });

  it("splits one-message-per-line results", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `[${i + 1}] 12/9/2026 · Aravind: message number ${i + 1} with enough text to look like a real chat line`);
    const split = splitResultItems(`30 message(s):\n\n#xyne-spaces · conversationId: c1\n\n${lines.join("\n")}`);
    expect(split?.items).toHaveLength(30);
    expect(split?.joiner).toBe("\n");
    expect(split?.head).toContain("30 message(s):");
  });

  it("splits a JSON array, and an object with one dominant array", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: i, title: `ticket ${i}` }));
    expect(splitResultItems(JSON.stringify(rows))?.items).toHaveLength(10);
    const wrapped = splitResultItems(JSON.stringify({ total: 10, results: rows }));
    expect(wrapped?.items).toHaveLength(10);
    expect(wrapped?.head).toContain('"total":10');
  });

  it("refuses to split prose, short lists, and code-like text", () => {
    expect(splitResultItems("One paragraph of prose.\n\nAnd a second one.")).toBeNull();
    expect(splitResultItems(Array.from({ length: 40 }, (_, i) => `x${i}`).join("\n"))).toBeNull();
  });
});

describe("selectItems", () => {
  const items = Array.from({ length: 10 }, (_, i) => `item ${i} ${"x".repeat(90)}`);

  it("keeps items at or above the threshold", () => {
    const scores = new Map(items.map((_, i) => [String(i), i < 7 ? 0.9 : 0.1]));
    expect([...selectItems(items, scores, 0.3, 100_000)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("always keeps a minimum even when nothing clears the threshold", () => {
    const scores = new Map(items.map((_, i) => [String(i), 0.01 * i]));
    expect(selectItems(items, scores, 0.9, 100_000).size).toBe(5);
  });

  it("keeps an item whose score never came back rather than silently dropping it", () => {
    const scores = new Map(items.map((_, i) => [String(i), 0.05]));
    scores.delete("9");
    expect(selectItems(items, scores, 0.3, 100_000).has(9)).toBe(true);
  });

  it("fills a tight budget best-first instead of head-first", () => {
    const scores = new Map(items.map((_, i) => [String(i), i >= 5 ? 0.95 : 0.4]));
    const keep = selectItems(items, scores, 0.3, 500);
    expect([...keep].sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9]);
  });
});

describe("siftToolResult", () => {
  const saved: Record<string, string | undefined> = {};
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env["JEV_API_KEY"] = "k";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
  });

  const task = "what is Aravind talking about in #xyne-spaces?";

  it("keeps the relevant hits in original order with header and footer intact", async () => {
    fetchMock.mockImplementation(jevReplyFor("compaction is dropping"));
    const out = await siftToolResult({ toolName: "spaces-search-v2", content: searchResult([2, 9, 15]), task, charBudget: 100_000 });
    expect(out).toMatchObject({ total: 20 });
    expect(out!.kept).toBeGreaterThanOrEqual(3);
    expect(out!.kept).toBeLessThanOrEqual(5);
    expect(out!.text.startsWith("Found 20 result(s):")).toBe(true);
    expect(out!.text).toContain("[Showing 1-20 of 300");
    expect(out!.text.indexOf("2. [message]")).toBeLessThan(out!.text.indexOf("9. [message]"));
    expect(out!.text.indexOf("9. [message]")).toBeLessThan(out!.text.indexOf("15. [message]"));
  });

  it("leaves the result alone when nearly everything is relevant", async () => {
    fetchMock.mockImplementation(jevReplyFor("["));
    const all = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(await siftToolResult({ toolName: "spaces-search-v2", content: searchResult(all), task, charBudget: 100_000 })).toBeNull();
  });

  it("leaves the result alone when Jev is down, when there is no task, or when it is small", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    expect(await siftToolResult({ toolName: "spaces-search-v2", content: searchResult([2]), task, charBudget: 100_000 })).toBeNull();
    fetchMock.mockImplementation(jevReplyFor("compaction"));
    expect(await siftToolResult({ toolName: "spaces-search-v2", content: searchResult([2]), task: "", charBudget: 100_000 })).toBeNull();
    expect(await siftToolResult({ toolName: "spaces-search-v2", content: "Found 1 result(s):\n\n1. hi", task, charBudget: 100_000 })).toBeNull();
  });
});

describe("tool-output seam", () => {
  const saved: Record<string, string | undefined> = {};
  let dir = "";
  beforeEach(async () => {
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env["JEV_API_KEY"] = "k";
    vi.stubGlobal("fetch", vi.fn(jevReplyFor("compaction is dropping")));
    dir = await mkdtemp(join(tmpdir(), "sift-"));
  });
  afterEach(async () => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  const inRun = <T>(opts: string, fn: () => Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      setImmediate(() => {
        pinRunOptimizations(opts);
        pinRunTask("what is Aravind talking about in #xyne-spaces?");
        fn().then(resolve, reject);
      });
    });

  it("filters the result, saves the whole thing first, and tells the model the true total", async () => {
    const full = searchResult([2, 9, 15]);
    const out = await inRun("none,+jev_result_sift", () => promoteIfOversized(dir, "custom", "spaces-search-v2", full));
    expect(out.length).toBeLessThan(full.length * 0.6);
    expect(out).toContain("of 20 items");
    expect(out).toContain("counts and totals must use 20");
    expect(out).toContain("\n2. [message]");
    expect(out).toContain("\n9. [message]");
    expect(out).toContain("\n15. [message]");
    expect(out).not.toContain("\n20. [message]");
    expect(out.match(/\[message\]/g)).toHaveLength(5);
    const files = await readdir(join(dir, ".context", "tool-results"));
    expect(files).toHaveLength(1);
    const onDisk = await readFile(join(dir, ".context", "tool-results", files[0]!), "utf8");
    expect(onDisk).toContain("1. [message]");
    expect(onDisk).toContain("20. [message]");
    expect(out).toContain(files[0]!);
  });

  it("changes nothing when the switch is off", async () => {
    const full = searchResult([2, 9, 15]);
    expect(await inRun("none", () => promoteIfOversized(dir, "custom", "spaces-search-v2", full))).toBe(full);
  });

  it("never filters a non-retrieval tool such as read", async () => {
    const full = searchResult([2]);
    expect(await inRun("all", () => promoteIfOversized(dir, "custom", "read", full))).toBe(full);
  });
});
