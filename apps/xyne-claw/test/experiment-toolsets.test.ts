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
