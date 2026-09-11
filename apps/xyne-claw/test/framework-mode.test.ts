import { describe, it, expect, vi, afterEach } from "vitest";
import { buildExperimentTools, type ExperimentContext } from "../src/experiment.js";

/**
 * Framework mode: a run hunts STRUCTURAL gaps (convention drift, missing paved
 * paths, change-amplification, boilerplate, duplication), not just copy-paste.
 * Two enforcement points, both driven here against mocked ledger state:
 *  - the ledger CLOSE-gate: a proved opportunity's note must carry a self-chosen
 *    Tag, at least one file:line, and a `Prevents:` consequence — NOT a >=3
 *    identical-occurrence count (which is the dedup-linter cage we removed).
 *  - the end-experiment DELIVERABLE gate: framework delivers a .md report, so
 *    requiring .html (the old bug) must not apply to it.
 */

const FUTURE = new Date(Date.now() + 60 * 60_000).toISOString();
const fctx = (o: Partial<ExperimentContext> = {}): ExperimentContext =>
  ({ id: "exp-1", epoch: 2, deadlineAt: FUTURE, kind: "framework", ...o });

function ledgerTool(c: ExperimentContext) {
  return buildExperimentTools(c, vi.fn()).find((t) => t.name === "experiment-ledger")!;
}

/** Record a proved framework opportunity with the given note; capture whether it
 *  reached the /findings POST (i.e. the close-gate passed). */
async function recordProved(c: ExperimentContext, note: string) {
  const posted = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/findings")) { posted(); return new Response(JSON.stringify({ success: true, data: { id: "f1", status: "proved" } }), { status: 200 }); }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }));
  const r = await ledgerTool(c).execute!("c1", {
    action: "record", status: "proved", title: "opp", hypothesis: "h", note,
  }) as { content: Array<{ text: string }>; details?: Record<string, unknown> };
  return { r, posted };
}

afterEach(() => vi.unstubAllGlobals());

describe("framework ledger close-gate (self-tagged, not occurrence-counted)", () => {
  it("accepts a proved opportunity carrying Tag + file:line + Prevents", async () => {
    const { r, posted } = await recordProved(fctx(),
      "Tag: convention-drift\nFive routes each hand-roll auth: src/a.ts:12, src/b.ts:40, src/c.ts:88\nPrevents: a route shipping with no auth check, as happened in the incident");
    expect(r.details?.error).toBeUndefined();
    expect(posted).toHaveBeenCalledOnce();
  });

  it("accepts a VARYING pattern (drift) with a single site — occurrence count is not the gate", async () => {
    // The whole point: divergent code, not 3 identical copies, still closes.
    const { r, posted } = await recordProved(fctx(),
      "Tag: missing-paved-path\nsrc/pagination/ad-hoc.ts:9 rolls its own paging\nPrevents: inconsistent page-size limits across endpoints");
    expect(r.details?.error).toBeUndefined();
    expect(posted).toHaveBeenCalledOnce();
  });

  it("refuses a close with no Tag", async () => {
    const { r, posted } = await recordProved(fctx(),
      "src/a.ts:12, src/b.ts:40\nPrevents: drift");
    expect(r.details?.needsFrameworkContract).toBe(true);
    expect(r.content[0]!.text).toContain("Tag:");
    expect(posted).not.toHaveBeenCalled();
  });

  it("refuses a close with no file:line evidence", async () => {
    const { r } = await recordProved(fctx(),
      "Tag: boilerplate\nlots of repeated setup\nPrevents: forgotten teardown");
    expect(r.details?.needsFrameworkContract).toBe(true);
    expect(r.content[0]!.text).toContain("file.ext:LINE");
  });

  it("refuses a close that names no consequence (taste, not opportunity)", async () => {
    const { r } = await recordProved(fctx(),
      "Tag: duplication\nsrc/a.ts:12, src/b.ts:40, src/c.ts:88");
    expect(r.details?.needsFrameworkContract).toBe(true);
    expect(r.content[0]!.text).toContain("Prevents:");
  });
});


describe("framework report prompt", () => {
  it("tells framework runs to include a Tag Index in the markdown report", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/routes/run.ts", import.meta.url), "utf8"));
    expect(source).toContain("Tag Index table");
    expect(source).toContain("tag name, finding count, affected areas, proposed paved path/framework abstraction, and migration cost");
  });
});

describe("framework end-experiment deliverable gate (markdown, not html)", () => {
  const FUTURE_LEDGER = (deliveredArtifacts: string[]) => vi.fn(async (url: string, init?: { method?: string }) => {
    if (url.endsWith("/ledger")) {
      return new Response(JSON.stringify({ success: true, data: {
        markdown: "", counts: { conjecture: 0, proved: 6, refuted: 0 }, deadlineAt: FUTURE, epoch: 2, deliveredArtifacts,
      } }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  });

  const end = async (c: ExperimentContext) => {
    const tool = buildExperimentTools(c, vi.fn()).find((t) => t.name === "end-experiment")!;
    return await tool.execute!("c1", { report: "done" }) as { content: Array<{ text: string }>; details?: Record<string, unknown> };
  };

  it("ends when the frontier is exhausted and a .md report was delivered", async () => {
    vi.stubGlobal("fetch", FUTURE_LEDGER(["framework-opportunities.md"]));
    const r = await end(fctx());
    expect(r.details?.refused).toBeUndefined();
    expect(r.content[0]!.text).toContain("complete");
  });

  it("refuses to end when only an .html was delivered (framework wants markdown)", async () => {
    vi.stubGlobal("fetch", FUTURE_LEDGER(["some-doc.html"]));
    const r = await end(fctx());
    expect(r.details?.refused).toBe(true);
    expect(r.details?.reason).toBe("missing-md-artifact");
  });
});
