import { describe, it, expect, vi } from "vitest";
import { buildExperimentTools, buildExperimentReviewTools, type ExperimentContext } from "../src/experiment.js";

/**
 * The CHECKER and the PARTICIPANT are different toolsets, and conflating them is
 * exactly the bug behind "experiment-review unavailable, verdicts not recorded":
 * the checker was handed participant tools, so it had no experiment-review and
 * wrongly held end-experiment. run.ts branches on experiment.mode to pick the
 * builder; these lock what each must (not) contain.
 */
const ctx: ExperimentContext = { id: "e1", epoch: 2, deadlineAt: new Date(Date.now() + 3_600_000).toISOString() };
const names = (tools: { name: string }[]) => new Set(tools.map((t) => t.name));

describe("experiment toolsets", () => {
  it("checker (review) has experiment-review and read-only ledger", () => {
    const n = names(buildExperimentReviewTools(ctx));
    expect(n.has("experiment-review")).toBe(true);
    expect(n.has("experiment-ledger-read")).toBe(true);
  });

  it("checker must NOT hold end-experiment or the ledger-write tool", () => {
    // The review prompt tells the agent it has neither; the toolset must match,
    // or a checker can end the run it is only supposed to be verifying.
    const n = names(buildExperimentReviewTools(ctx));
    expect(n.has("end-experiment")).toBe(false);
    expect(n.has("experiment-ledger")).toBe(false);
  });

  it("participant has the ledger-write + end-experiment tools", () => {
    const n = names(buildExperimentTools(ctx, vi.fn()));
    expect(n.has("experiment-ledger")).toBe(true);
    expect(n.has("end-experiment")).toBe(true);
  });

  it("participant does NOT get experiment-review", () => {
    expect(names(buildExperimentTools(ctx, vi.fn())).has("experiment-review")).toBe(false);
  });
});

describe("end-experiment by exit rule", () => {
  const end = async (kind: ExperimentContext["kind"]) => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { markdown: "L", counts: { conjecture: 1, proved: 0, refuted: 0 }, deadlineAt: "", epoch: 2 } }), { status: 200 })) as never;
    const tool = buildExperimentTools({ ...ctx, ...(kind ? { kind } : {}) }, vi.fn()).find((t) => t.name === "end-experiment")!;
    return (await tool.execute("t", { report: "done" } as never, undefined as never, undefined as never, undefined as never)) as { details?: { refused?: boolean } };
  };

  it("lets a judge-gated /ui-test report pass end before the deadline", async () => {
    expect((await end("ui-test")).details?.refused).toBeUndefined();
  });

  it("still refuses a time-boxed /experiment before its deadline", async () => {
    expect((await end(undefined)).details?.refused).toBe(true);
  });
});
