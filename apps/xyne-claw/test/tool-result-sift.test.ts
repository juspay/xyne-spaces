import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { siftText, splitSections, toolResultSiftExtension, type SectionScorer } from "../src/tool-result-sift.js";
import { promoteIfOversized } from "../src/tool-output.js";
import { pinRunOptimizations } from "../src/optimizations.js";
import { pinRunTask } from "../src/run-context.js";

const ENV = ["JEV_API_KEY", "JEV_URL", "JUDGE_BACKEND", "JUDGE_SHADOW", "XYNE_OPT_ALL", "JEV_TOOL_SIFT_MIN_CHARS", "JEV_TOOL_SIFT_THRESHOLD"];

function haskellFile(target: string, count = 24): string {
  const header = ["module Router where", "", "import Data.List (sortOn)", "import Gateway", ""].join("\n");
  const decls = Array.from({ length: count }, (_, i) => {
    const name = i === 7 ? target : `helper${i}`;
    return [
      `${name} :: Txn -> Gateway -> IO Result`,
      `${name} txn gw = do`,
      ...Array.from({ length: 14 }, (__, j) => `  let step${j} = compute${i} txn gw ${j} -- ${"detail ".repeat(4)}`),
      `  pure (Result step0)`,
    ].join("\n");
  });
  return `${header}\n${decls.join("\n\n")}\n`;
}

function buildLog(): string {
  const lines = Array.from({ length: 400 }, (_, i) => `[build] compiling module Mod${i}.hs ... ok ${"-".repeat(20)}`);
  lines[210] = "src/Router.hs:88:5: error: Couldn't match type 'Gateway' with 'Maybe Gateway'";
  lines[399] = "BUILD FAILED: 1 error";
  return lines.join("\n");
}

const scoreBy = (needle: string): SectionScorer => async (sections) =>
  new Map(sections.map((s, i) => [i, s.text.includes(needle) ? 0.9 : 0.05]));

function jevReplyFor(needle: string) {
  return async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as { questions: Record<string, { instructions: string }> };
    const answers = Object.fromEntries(
      Object.entries(body.questions).map(([id, q]) => [id, { type: "noul", noul: q.instructions.includes(needle) ? 0.92 : 0.04 }]),
    );
    return new Response(JSON.stringify({ answers }), { status: 200 });
  };
}

describe("splitSections", () => {
  it("splits a source file at top-level declarations and keeps line numbers", () => {
    const sections = splitSections(haskellFile("routeTxn"), "file");
    expect(sections.length).toBeGreaterThan(10);
    expect(sections[0]?.start).toBe(1);
    const route = sections.find((s) => s.text.startsWith("routeTxn ::"));
    expect(route).toBeDefined();
    for (let i = 1; i < sections.length; i += 1) expect(sections[i]?.start).toBe((sections[i - 1]?.end ?? 0) + 1);
  });

  it("offsets line numbers when the text starts part-way through a file", () => {
    expect(splitSections(haskellFile("routeTxn"), "file", 101)[0]?.start).toBe(101);
  });

  it("cuts one huge declaration into chunks", () => {
    const big = ["bigFn :: Int", ...Array.from({ length: 300 }, (_, i) => `  x${i} = ${i}`)].join("\n");
    const sections = splitSections(big, "file");
    expect(sections.length).toBe(6);
    expect(Math.max(...sections.map((s) => s.end - s.start + 1))).toBeLessThanOrEqual(60);
  });

  it("chunks command output into fixed blocks", () => {
    expect(splitSections(buildLog(), "log")).toHaveLength(10);
  });
});

describe("siftText", () => {
  beforeEach(() => {
    delete process.env["JEV_TOOL_SIFT_MIN_CHARS"];
    delete process.env["JEV_TOOL_SIFT_THRESHOLD"];
  });

  it("keeps the header and the relevant declaration, and marks what was left out with line numbers", async () => {
    const text = haskellFile("routeTxn");
    const out = await siftText({ text, kind: "file", label: "Router.hs", task: "why does routing pick the wrong gateway?", scorer: scoreBy("routeTxn") });
    expect(out).not.toBeNull();
    expect(out?.text).toContain("module Router where");
    expect(out?.text).toContain("routeTxn txn gw = do");
    expect(out?.text).not.toContain("helper12 txn gw = do");
    expect(out?.text).toMatch(/── lines \d+–\d+ omitted \(\d+ lines\): helper\d+ ::/);
    expect(out?.charsAfter).toBeLessThan(text.length * 0.5);
  });

  it("always keeps the start and the end of command output", async () => {
    const out = await siftText({ text: buildLog(), kind: "log", label: "sandbox-run (stdout)", task: "fix the build", scorer: scoreBy("error:") });
    expect(out?.text).toContain("Mod0.hs");
    expect(out?.text).toContain("Couldn't match type");
    expect(out?.text).toContain("BUILD FAILED: 1 error");
    expect(out?.text).not.toContain("Mod130.hs");
  });

  it("leaves small outputs alone", async () => {
    expect(await siftText({ text: "module A where\n", kind: "file", label: "A.hs", task: "x", scorer: scoreBy("A") })).toBeNull();
  });

  it("leaves the output alone when most of it is relevant", async () => {
    const out = await siftText({ text: haskellFile("routeTxn"), kind: "file", label: "Router.hs", task: "x", scorer: async (s) => new Map(s.map((_, i) => [i, 0.9])) });
    expect(out).toBeNull();
  });

  it("leaves the output alone when Jev is unavailable", async () => {
    expect(await siftText({ text: haskellFile("routeTxn"), kind: "file", label: "Router.hs", task: "x", scorer: async () => null })).toBeNull();
  });
});

describe("promoteIfOversized with jev_tool_result_sift", () => {
  const saved: Record<string, string | undefined> = {};
  let dir = "";
  beforeEach(async () => {
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env["JEV_API_KEY"] = "k";
    dir = await mkdtemp(join(tmpdir(), "tool-sift-"));
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
        pinRunTask("why does routing pick the wrong gateway?");
        fn().then(resolve, reject);
      });
    });

  it("trims a large sandbox-read-file result and tells the model how to fetch the rest", async () => {
    vi.stubGlobal("fetch", vi.fn(jevReplyFor("routeTxn")));
    const raw = JSON.stringify({ path: "/repo/src/Router.hs", content: haskellFile("routeTxn"), encoding: "utf8", totalLines: 400 });
    const out = await inRun("none,+jev_tool_result_sift", () => promoteIfOversized(dir, "custom", "sandbox-read-file", raw));
    const parsed = JSON.parse(out) as { content: string; sifted: string; path: string };
    expect(parsed.path).toBe("/repo/src/Router.hs");
    expect(parsed.content).toContain("routeTxn txn gw = do");
    expect(parsed.content).toContain("omitted");
    expect(parsed.sifted).toContain("sandbox-read-file offset/limit");
    expect(out.length).toBeLessThan(raw.length * 0.6);
  });

  it("trims sandbox-run stdout, keeps the exit code, and saves the full output", async () => {
    vi.stubGlobal("fetch", vi.fn(jevReplyFor("error:")));
    const raw = JSON.stringify({ stdout: buildLog(), stderr: "", exitCode: 1 });
    const out = await inRun("none,+jev_tool_result_sift", () => promoteIfOversized(dir, "custom", "sandbox-run", raw));
    const parsed = JSON.parse(out) as { stdout: string; exitCode: number; sifted: string };
    expect(parsed.exitCode).toBe(1);
    expect(parsed.stdout).toContain("Couldn't match type");
    const savedPath = parsed.sifted.match(/saved at (\S+\.json)/)?.[1] ?? "";
    expect(await readFile(savedPath, "utf8")).toContain("Mod120.hs");
  });

  it("changes nothing when the switch is off", async () => {
    const fetchMock = vi.fn(jevReplyFor("routeTxn"));
    vi.stubGlobal("fetch", fetchMock);
    const raw = JSON.stringify({ path: "/repo/src/Router.hs", content: haskellFile("routeTxn"), encoding: "utf8" });
    const out = await inRun("none", () => promoteIfOversized(dir, "custom", "sandbox-read-file", raw));
    expect(out).toBe(raw);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the untouched result when Jev fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    const raw = JSON.stringify({ path: "/repo/src/Router.hs", content: haskellFile("routeTxn"), encoding: "utf8" });
    const out = await inRun("none,+jev_tool_result_sift", () => promoteIfOversized(dir, "custom", "sandbox-read-file", raw));
    expect(out).toBe(raw);
  });
});

describe("toolResultSiftExtension (built-in read)", () => {
  type Handler = (event: Record<string, unknown>) => Promise<{ content?: Array<{ type: string; text?: string }> } | undefined>;
  const handler = (): Handler => {
    let h: Handler | undefined;
    toolResultSiftExtension({ on: (name: string, fn: Handler) => { if (name === "tool_result") h = fn; } } as never);
    if (!h) throw new Error("no handler");
    return h;
  };
  const inRun = <T>(opts: string, fn: () => Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => setImmediate(() => { pinRunOptimizations(opts); pinRunTask("why does routing pick the wrong gateway?"); fn().then(resolve, reject); }));
  const event = (path: string) => ({ type: "tool_result", toolName: "read", toolCallId: "1", input: { path }, isError: false, content: [{ type: "text", text: haskellFile("routeTxn") }] });

  beforeEach(() => {
    process.env["JEV_API_KEY"] = "k";
    vi.stubGlobal("fetch", vi.fn(jevReplyFor("routeTxn")));
  });
  afterEach(() => {
    delete process.env["JEV_API_KEY"];
    vi.unstubAllGlobals();
  });

  it("sifts a large project file read", async () => {
    const out = await inRun("none,+jev_tool_result_sift", () => handler()(event("/repo/src/Router.hs")));
    expect(out?.content?.[0]?.text).toContain("read offset/limit");
    expect(out?.content?.[0]?.text).toContain("routeTxn txn gw = do");
  });

  it("never touches skill, memory or spilled-result reads", async () => {
    for (const path of ["/app/skills/charts/SKILL.md", "/data/memory/notes.md", "/s/.context/tool-results/x.json"]) {
      expect(await inRun("none,+jev_tool_result_sift", () => handler()(event(path)))).toBeUndefined();
    }
  });

  it("does nothing with the switch off", async () => {
    expect(await inRun("none", () => handler()(event("/repo/src/Router.hs")))).toBeUndefined();
  });
});
