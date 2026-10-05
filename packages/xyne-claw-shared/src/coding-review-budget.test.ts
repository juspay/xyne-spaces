import { describe, expect, it } from "vitest";
import {
  CODING_REVIEW_MAX_CYCLES,
  isCodingCoordinator,
  nextCodingReviewCycle,
  type CodingReviewState,
} from "./coding-review-budget.js";

describe("coding-review-budget", () => {
  it("blocks on cycle 3 failure", () => {
    let state: CodingReviewState = { cycle: 0, lastVerdict: null };
    state = nextCodingReviewCycle(state, "FAIL");
    expect(state.cycle).toBe(1);
    state = nextCodingReviewCycle(state, "FAIL");
    expect(state.cycle).toBe(2);
    state = nextCodingReviewCycle(state, "FAIL");
    expect(state.lastVerdict).toBe("BLOCKED");
    expect(state.cycle).toBe(CODING_REVIEW_MAX_CYCLES);
  });

  it("detects coding coordinators by tool slug", () => {
    expect(isCodingCoordinator(["spaces"])).toBe(false);
    expect(isCodingCoordinator(["sandbox-run"])).toBe(true);
  });
});
