import { describe, it, expect, vi, afterEach } from "vitest";
import { buildExperimentTools, type ExperimentContext } from "../src/experiment.js";

/**
 * The end-experiment gate for coverage-gated /understanding runs. Three
 * conditions must all hold before the run may end: the frontier is exhausted
 * (open === 0), the floor is met (>= 5 closed), and the HTML deliverable was
 * actually delivered. Each is enforced against real ledger state, not the
 * model's word — so each is driven here by a mocked /ledger response.
 */

const FUTURE = new Date(Date.now() + 60 * 60_000).toISOString();

function ctx(overrides: Partial<ExperimentContext> = {}): ExperimentContext {
  return { id: "exp-1", epoch: 2, deadlineAt: FUTURE, kind: "understanding", ...overrides };
}

/** Stub claw-auth: /ledger returns the given counts+artifacts; /complete succeeds. */
function stubLedger(opts: {
  conjecture: number;
  proved: number;
  refuted?: number;
  deliveredArtifacts?: string[];
}) {
  const complete = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      if (url.endsWith("/ledger")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              markdown: "",
              counts: { conjecture: opts.conjecture, proved: opts.proved, refuted: opts.refuted ?? 0 },
              deadlineAt: FUTURE,
              epoch: 2,
              deliveredArtifacts: opts.deliveredArtifacts ?? [],
            },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/complete")) {
        complete(init);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }),
  );
  return { complete };
}

function endTool(c: ExperimentContext) {
  const abortRun = vi.fn();
  const tool = buildExperimentTools(c, abortRun).find((t) => t.name === "end-experiment")!;
  return { tool, abortRun };
}

const runEnd = async (c: ExperimentContext) => {
  const { tool } = endTool(c);
  const r = await tool.execute!("call-1", { report: "done" });
  return r as { content: Array<{ text: string }>; details?: Record<string, unknown> };
};

afterEach(() => vi.unstubAllGlobals());

describe("understanding end-experiment gate", () => {
  it("refuses to end when the frontier is not exhausted", async () => {
    stubLedger({ conjecture: 12, proved: 3 });
    const r = await runEnd(ctx());
    expect(r.details?.refused).toBe(true);
    expect(r.content[0]!.text).toContain("frontier is not exhausted");
  });

  it("refuses when the frontier is empty but the floor is not met", async () => {
    // open === 0 but only one path closed — the degenerate one-path exit.
    stubLedger({ conjecture: 0, proved: 1 });
    const r = await runEnd(ctx());
    expect(r.details?.refused).toBe(true);
    expect(r.content[0]!.text).toContain("path(s) closed");
  });

  it("refuses when work is done but the HTML document was never delivered", async () => {
    stubLedger({ conjecture: 0, proved: 6, deliveredArtifacts: ["notes.md", "diagram.svg"] });
    const r = await runEnd(ctx());
    expect(r.details?.refused).toBe(true);
    expect(r.details?.reason).toBe("missing-html-artifact");
    expect(r.content[0]!.text).toContain("sandbox-deliver-files");
  });

  it("ends when the frontier is exhausted, the floor is met, and an .html was delivered", async () => {
    const { complete } = stubLedger({
      conjecture: 0,
      proved: 6,
      deliveredArtifacts: ["tables-explained.HTML"], // case-insensitive
    });
    const r = await runEnd(ctx());
    expect(r.details?.refused).toBeUndefined();
    expect(r.content[0]!.text).toContain("complete");
    expect(complete).toHaveBeenCalledOnce();
  });

  it("does not gate on the HTML for a classic (non-understanding) experiment", async () => {
    // Past deadline, plain experiment: ends with no artifact requirement.
    const past = new Date(Date.now() - 60_000).toISOString();
    const { complete } = stubLedger({ conjecture: 4, proved: 0 });
    const r = await runEnd(ctx({ kind: undefined, deadlineAt: past }));
    expect(r.details?.refused).toBeUndefined();
    expect(complete).toHaveBeenCalledOnce();
  });

  it("fails OPEN when the ledger is unreachable, rather than stranding a finished run", async () => {
    // Past the safety cap + ledger down: we cannot verify the artifact, so we
    // must not block forever on our own blindness.
    const past = new Date(Date.now() - 60_000).toISOString();
    const complete = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string }) => {
      if (url.endsWith("/ledger")) throw new Error("ledger down");
      if (url.endsWith("/complete")) { complete(init); return new Response(JSON.stringify({ success: true }), { status: 200 }); }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }));
    const r = await runEnd(ctx({ deadlineAt: past }));
    expect(r.details?.refused).toBeUndefined();
    expect(complete).toHaveBeenCalledOnce();
  });
});
