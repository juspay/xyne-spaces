/**
 * Coding-coordinator review budget: cycle 3 is terminal (BLOCKED).
 * Only apply when the agent has repo-write tools — not for inbox/Q&A agents.
 */

export const CODING_REVIEW_MAX_CYCLES = 3;

export type CodingReviewVerdict = "PASS" | "FAIL" | "BLOCKED";

export interface CodingReviewState {
  cycle: number;
  lastVerdict: CodingReviewVerdict | null;
}

export function nextCodingReviewCycle(
  state: CodingReviewState,
  verdict: "PASS" | "FAIL",
): CodingReviewState {
  if (verdict === "PASS") {
    return { cycle: state.cycle, lastVerdict: "PASS" };
  }
  const nextCycle = state.cycle + 1;
  if (nextCycle >= CODING_REVIEW_MAX_CYCLES) {
    return { cycle: CODING_REVIEW_MAX_CYCLES, lastVerdict: "BLOCKED" };
  }
  return { cycle: nextCycle, lastVerdict: "FAIL" };
}

export function isCodingCoordinator(toolSlugs: string[]): boolean {
  return toolSlugs.some((slug) =>
    /sandbox|apply_patch|git|repo|code-edit|filesystem\.write/i.test(slug),
  );
}
