/**
 * Subagent isolation notes for agent creation upgrades.
 *
 * Measurement (code review of apps/xyne-claw/src/subagent-tools.ts):
 * - Child sessions already materialize their own skills under session-skills/.
 * - Parent receives a distilled tool result / summary, not the full child
 *   transcript, when the subagent tool returns.
 * - Do NOT add a parallel /agent spawn path that writes an agents row.
 * - /agent spawn (product) must create a run only; catalog agents still go
 *   through propose-agent + human approve.
 * - File-scope locks + 3-cycle review apply only when isCodingCoordinator(tools).
 */

export const SUBAGENT_ISOLATION_AUDIT = {
  measuredAt: "2026-09-24",
  parentReceivesSummaryOnly: true,
  secondSpawnPathNeeded: false,
  codingReviewOnlyForRepoWrite: true,
} as const;
