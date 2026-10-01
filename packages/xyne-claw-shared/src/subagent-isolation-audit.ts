/**
 * Subagent isolation notes for agent creation upgrades.
 *
 * Measurement (2026-09-24) — apps/xyne-claw/src/subagent-tools.ts +
 * AgentDelegationGrant (claw-auth prisma):
 *
 * - Child sessions materialize their own skills under session-skills/.
 * - Parent receives a distilled tool result / summary (+ optional cited tool
 *   outputs and artifact markers), not the full child transcript, when the
 *   subagent tool returns (`doExecuteInner` → text content for the parent loop).
 * - AgentDelegationGrant is fail-closed: no enabled grant ⇒ claw never mounts
 *   a callable-agent tool for that pair. Orthogonal to spawn isolation.
 * - Do NOT add a parallel /agent spawn path that writes an agents row.
 * - /agent spawn (product) must create a run only; catalog agents still go
 *   through propose-agent + human approve.
 * - File-scope locks + 3-cycle review apply only when isCodingCoordinator(tools).
 *
 * Decision: summary path already exists → extend helpers only
 * (coding-review-budget); no second spawn implementation.
 */

export const SUBAGENT_ISOLATION_AUDIT = {
  measuredAt: "2026-09-24",
  parentReceivesSummaryOnly: true,
  secondSpawnPathNeeded: false,
  codingReviewOnlyForRepoWrite: true,
  agentDelegationGrantFailClosed: true,
} as const;
