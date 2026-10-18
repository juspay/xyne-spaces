/**
 * Wire contracts for classifier-backed decisions that xyne-claw makes and
 * claw-auth consumes over S2S. One definition here so the two sides cannot
 * drift (a new `source`, a renamed field) without a compile error on both.
 *
 * Only types and pure guards live here — the deciding logic stays in
 * xyne-claw, the HTTP client stays in claw-auth.
 */

// ── Goal judge (POST /goal-judge) ────────────────────────────────────────────

/** Metadata (never bytes) for a file the worker attached this turn. */
export interface GoalJudgeAttachmentMeta {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/** Request body claw-auth sends and claw's judge reads. */
export interface GoalJudgeRequest {
  /** Verbatim user-supplied goal condition (e.g. "all unit tests pass"). */
  condition: string;
  /** Output of the most recently completed turn (kept separate for recency). */
  lastTurnOutput: string;
  /** 1-based turn count after this turn. */
  turnCount: number;
  /** Hard cap from the goal record. The judge may stop earlier on overrun signals. */
  maxTurns: number;
  /** Optional: bounded trace of prior turns plus the latest turn. */
  recentTurnsDigest?: string;
  /** Files the worker attached to its reply this turn — metadata only. Surfaces
   *  non-text artefacts (HTML reports, CSV, PDFs) so artefact goals aren't
   *  falsely failed because the judge only sees the text body. */
  attachmentsThisTurn?: GoalJudgeAttachmentMeta[];
}

export interface GoalJudgeDecision {
  done: boolean;
  reason: string;
}

/** Reason the claw-auth client returns when it could not get a decision. */
export const GOAL_JUDGE_UNAVAILABLE_REASON = "judge_unavailable";

// ── Twin respond gate (POST /internal/user-memory/should-respond) ────────────

/** How a respond-gate decision was reached. */
export const RESPOND_GATE_SOURCES = ["jev", "llm", "fail-closed", "no-patterns"] as const;
export type RespondGateSource = (typeof RESPOND_GATE_SOURCES)[number];

export function isRespondGateSource(value: unknown): value is RespondGateSource {
  return typeof value === "string" && (RESPOND_GATE_SOURCES as readonly string[]).includes(value);
}

/** The decision itself, as both sides see it (traces travel alongside, not in it). */
export interface RespondGateDecision {
  respond: boolean;
  /** 0-1 */
  confidence: number;
  reason: string;
  source: RespondGateSource;
}
