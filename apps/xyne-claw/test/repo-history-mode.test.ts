import { describe, it, expect, vi, afterEach } from "vitest";
import { buildExperimentTools, type ExperimentContext } from "../src/experiment.js";

/**
 * Repo-history mode: a PROGRESS-gated run that walks git history oldest→newest,
 * distilling each commit batch into the durable coding RULE it establishes (not
 * a changelog), reconciled against HEAD. Two enforcement points, driven here
 * against mocked ledger state:
 *  - the ledger CLOSE-gate: a proved batch's note must carry a `Rule:` line, a
 *    `sha:` it derives from, and a theme `Tag:`. This blocks the failure mode of
 *    recording "commit X changed Y" (a diff) instead of the reusable decision.
 *  - the end-experiment DELIVERABLE gate: repo-history delivers a .md decision
 *    log (like framework), so requiring .html must NOT apply to it.
 */

const FUTURE = new Date(Date.now() + 60 * 60_000).toISOString();
const rctx = (o: Partial<ExperimentContext> = {}): ExperimentContext =>
  ({ id: "exp-1", epoch: 3, deadlineAt: FUTURE, kind: "repo-history", ...o });

function ledgerTool(c: ExperimentContext) {
  return buildExperimentTools(c, vi.fn()).find((t) => t.name === "experiment-ledger")!;
}

async function recordProved(c: ExperimentContext, note: string) {
  const posted = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/findings")) { posted(); return new Response(JSON.stringify({ success: true, data: { id: "f1", status: "proved" } }), { status: 200 }); }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }));
  const r = await ledgerTool(c).execute!("c1", {
    action: "record", status: "proved", title: "batch", hypothesis: "h", note,
  }) as { content: Array<{ text: string }>; details?: Record<string, unknown> };
  return { r, posted };
}

afterEach(() => vi.unstubAllGlobals());

describe("repo-history ledger close-gate (Rule + sha + Tag)", () => {
  it("accepts a proved batch carrying Rule + sha + Tag", async () => {
    const { r, posted } = await recordProved(rctx(),
      "Tag: provider-fallback\nsha: 3a0edf4\nRule: automation runs must use the app-token Spaces MCP, never the user session, so headless attachment downloads don't 401.");
    expect(r.details?.error).toBeUndefined();
    expect(posted).toHaveBeenCalledOnce();
  });

  it("refuses a close with no Rule (a changelog, not a decision)", async () => {
    const { r, posted } = await recordProved(rctx(),
      "Tag: provider-fallback\nsha: 3a0edf4\nCommit swapped routes/mcp.ts to app mode.");
    expect(r.details?.needsRepoHistoryContract).toBe(true);
    expect(posted).not.toHaveBeenCalled();
  });

  it("refuses a close with no sha", async () => {
    const { r, posted } = await recordProved(rctx(),
      "Tag: security\nRule: read endpoints return the full sanitized agent; gate writes, never hide fields on read.");
    expect(r.details?.needsRepoHistoryContract).toBe(true);
    expect(posted).not.toHaveBeenCalled();
  });

  it("refuses a close with no Tag", async () => {
    const { r, posted } = await recordProved(rctx(),
      "sha: b4c7a8b\nRule: never route subagents off the platform default without an explicit per-agent override.");
    expect(r.details?.needsRepoHistoryContract).toBe(true);
    expect(posted).not.toHaveBeenCalled();
  });

  it("does NOT apply the repo-history contract to other kinds", async () => {
    // A plain understanding close (with a file:line citation) must not be forced
    // to carry Rule/sha/Tag — the gate is kind-scoped.
    const { r, posted } = await recordProved(rctx({ kind: "understanding" }),
      "The dispatcher resolves the provider at src/routes/run.ts:1912 and forwards it.");
    expect(r.details?.needsRepoHistoryContract).toBeUndefined();
    expect(posted).toHaveBeenCalledOnce();
  });
});

describe("repo-history is COMMIT-bound, not time-bound", () => {
  const PAST = new Date(Date.now() - 60 * 60_000).toISOString();
  const ledgerStub = (open: number, artifacts: string[]) => vi.fn(async (url: string) => {
    if (url.endsWith("/ledger")) {
      return new Response(JSON.stringify({ success: true, data: { counts: { conjecture: open, proved: 8, refuted: 2 }, deliveredArtifacts: artifacts } }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  });

  it("refuses to end PAST the deadline while commits remain (open > 0)", async () => {
    vi.stubGlobal("fetch", ledgerStub(12, ["repo-decisions.html"]));
    const end = buildExperimentTools(rctx({ deadlineAt: PAST }), vi.fn()).find((t) => t.name === "end-experiment")!;
    const r = await end.execute!("c1", { report: "done" }) as { details?: Record<string, unknown> };
    expect(r.details?.refused).toBe(true); // deadline is NOT an escape — only HEAD ends it
  });

  it("understanding DOES release at the deadline (control — deadline is a cap there)", async () => {
    vi.stubGlobal("fetch", ledgerStub(12, ["explained.html"]));
    const end = buildExperimentTools(rctx({ kind: "understanding", deadlineAt: PAST }), vi.fn()).find((t) => t.name === "end-experiment")!;
    const r = await end.execute!("c1", { report: "done" }) as { details?: Record<string, unknown> };
    expect(r.details?.refused).toBeUndefined();
  });

  it("repo-history ends past the deadline once the frontier is exhausted (all commits walked)", async () => {
    vi.stubGlobal("fetch", ledgerStub(0, ["repo-decisions.html"]));
    const end = buildExperimentTools(rctx({ deadlineAt: PAST }), vi.fn()).find((t) => t.name === "end-experiment")!;
    const r = await end.execute!("c1", { report: "done" }) as { details?: Record<string, unknown> };
    expect(r.details?.refused).toBeUndefined();
  });
});

describe("repo-history deliverable gate wants .html, not .md", () => {
  it("refuses end when only a .md artifact was delivered", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/ledger")) {
        return new Response(JSON.stringify({ success: true, data: { counts: { conjecture: 0, proved: 8, refuted: 2 }, deliveredArtifacts: ["repo-decisions.md"] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }));
    const end = buildExperimentTools(rctx(), vi.fn()).find((t) => t.name === "end-experiment")!;
    const r = await end.execute!("c1", { report: "done" }) as { details?: Record<string, unknown> };
    expect(r.details?.refused).toBe(true);
  });

  it("accepts end when a self-contained .html decision log was delivered and the frontier is exhausted", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/ledger")) {
        return new Response(JSON.stringify({ success: true, data: { counts: { conjecture: 0, proved: 8, refuted: 2 }, deliveredArtifacts: ["repo-decisions.html"] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }));
    const end = buildExperimentTools(rctx(), vi.fn()).find((t) => t.name === "end-experiment")!;
    const r = await end.execute!("c1", { report: "done" }) as { details?: Record<string, unknown> };
    expect(r.details?.refused).toBeUndefined();
  });
});
