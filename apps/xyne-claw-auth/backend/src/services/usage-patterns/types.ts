/**
 * Usage patterns — what an agent is actually used for, written back as a file
 * humans can correct and as a `kind:usage` blob the orchestrator can search.
 *
 * The corpus is deliberately thin: per run only { task, status, rating,
 * toolsUsed, totalMs }. The result body is never read, so the richest source of
 * retrieved customer data never enters the pipeline at all.
 */

/** Half-open window [start, end) over `agent_runs.startedAt`. */
export interface UsageWindow {
  start: Date;
  end: Date;
}

export type RunStatus = "running" | "completed" | "failed" | "cancelled";
export type RunRating = "up" | "down";

/**
 * One run, reduced. `ref` is the only handle the model is given — run ids and
 * session ids stay on this side, so a hallucinated citation cannot resolve and
 * a real one cannot leak an identifier back out.
 */
export interface UsageSample {
  ref: string;
  task: string;
  status: RunStatus;
  rating: RunRating | null;
  toolsUsed: string[];
  totalMs: number | null;
  /** Hashed — distinct-user thresholds need identity, not the identity itself. */
  userRef: string;
  /** Reconstructed from a caller's `call-agent` invocation rather than a row. */
  delegated: boolean;
}

export interface ToolUsage {
  tool: string;
  runs: number;
}

export interface UsageCorpus {
  slug: string;
  window: { start: string; end: string };
  samples: UsageSample[];
  /** Samples analysed — capped by MAX_SAMPLES, not the window's true total.
   *  Every share in the file is a fraction of this, never of `windowRuns`. */
  runCount: number;
  /** Terminal runs in the window. Reported alongside `runCount` so a capped
   *  corpus cannot read as an agent nobody uses. */
  windowRuns: number;
  distinctUsers: number;
  delegatedCount: number;
  toolUsage: ToolUsage[];
}

export type PatternKind = "demand" | "gap";

/**
 * What the distiller returns, normalized.
 *
 * `refs` is the strong form — the model names a pattern and cites the runs, and
 * this side does every piece of arithmetic. The curator on claw does not cite,
 * so `claimedShare` / `claimedUsers` carry its own figures instead; those are
 * clamped against the corpus before they are believed, never used raw.
 */
export interface DistilledPattern {
  kind: PatternKind;
  summary: string;
  refs: string[];
  claimedShare?: number;
  claimedUsers?: number;
}

/** A pattern that survived the aggregation thresholds, with counts we computed. */
export interface UsagePattern extends DistilledPattern {
  runs: number;
  users: number;
  /** Share of the analysed corpus, 0..1. */
  share: number;
  /** Share of this pattern's runs that failed or were rated down, 0..1. Null
   *  when the distiller cited no runs, so there is nothing to measure it over. */
  failureRate: number | null;
}

/** The stored file as an operator reads it — `humanEdited` is the flag that
 *  says whether the synthesizer will ever touch it again. */
export interface UsagePatternFile {
  slug: string;
  name: string;
  content: string;
  chars: number;
  updatedBy: string | null;
  updatedAt: string;
  humanEdited: boolean;
}

export type SkipReason =
  | "no-runs"
  | "insufficient-corpus"
  | "distill-failed"
  | "no-patterns"
  | "human-edited";

export interface SynthesisOutcome {
  slug: string;
  runCount: number;
  distinctUsers: number;
  patternsWritten: number;
  skipped?: SkipReason;
  chars: number;
}
