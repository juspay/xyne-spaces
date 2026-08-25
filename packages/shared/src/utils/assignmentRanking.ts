// How a user group ranks its already-eligible members, shared by the backend
// engine (assignmentEngine.ts) and the dashboard's Visibility tab preview.
//
// It lives here because the preview's whole job is to show who the engine will
// pick next: if the two orderings drift, the preview lies. One comparator per
// strategy, used by both.
//
// Ranking is the ONLY thing a strategy decides. Eligibility (responsibility,
// on-call/active, channel participation), the per-user maxTickets cap and the
// group maxWorkload cap are applied identically before and after, by the caller.

// `.js` extension: this is a value import (the enum backs COMPARATORS at
// runtime), and the package is ESM — extensionless would not resolve in Node.
import { AssignmentStrategy } from '../zero/types.js';

/**
 * A member the engine has never picked sorts ahead of everyone holding a real
 * timestamp, so a newly added member gets the next ticket.
 */
export const NEVER_ASSIGNED_RANK = -1;

/** The minimum a candidate must expose to be ranked, whatever the strategy. */
export interface RankableAssignee {
  userId: string;
  /** Workload score, lowest-wins. Callers with no score substitute their load. */
  score: number;
  /** Raw weighted load, before the cold-start offset. */
  weightedActiveTasks: number;
  /** Round-robin cursor as epoch ms; null when never picked. */
  lastAssignedAt: number | null;
}

export type AssigneeComparator = (a: RankableAssignee, b: RankableAssignee) => number;

const byLowestScore: AssigneeComparator = (a, b) => a.score - b.score;

/**
 * Ties on the cursor are the common case, not the edge case: every member who
 * has never been picked shares NEVER_ASSIGNED_RANK, and members picked in the
 * same batch share a timestamp. So ties break on the lighter workload first;
 * `userId` only settles a genuine dead heat, because breaking on it alone would
 * hand every tie to whoever sorts first alphabetically.
 */
const byLeastRecentlyAssigned: AssigneeComparator = (a, b) =>
  (a.lastAssignedAt ?? NEVER_ASSIGNED_RANK) - (b.lastAssignedAt ?? NEVER_ASSIGNED_RANK) ||
  a.weightedActiveTasks - b.weightedActiveTasks ||
  a.userId.localeCompare(b.userId);

/**
 * Exhaustive by construction: a new AssignmentStrategy member fails to compile
 * until its ranking is defined here, rather than silently falling back.
 */
const COMPARATORS: Record<AssignmentStrategy, AssigneeComparator> = {
  [AssignmentStrategy.WORKLOAD]: byLowestScore,
  [AssignmentStrategy.ROUND_ROBIN]: byLeastRecentlyAssigned,
};

/** Best-first comparator for `strategy`. */
export function comparatorFor(strategy: AssignmentStrategy): AssigneeComparator {
  return COMPARATORS[strategy];
}

/**
 * Narrow a stored `user_groups.assignmentStrategy` to a known strategy.
 *
 * Returns null for anything unrecognised — including groups that predate the
 * column — so the caller decides how loudly to fall back. It is deliberately not
 * silent-defaulted here: a group configured for ROUND_ROBIN that quietly assigns
 * by workload is exactly the bug worth logging.
 */
export function parseAssignmentStrategy(raw: string | null | undefined): AssignmentStrategy | null {
  // hasOwnProperty, not `in` — `in` walks the prototype chain, so a stored value
  // of 'toString' or 'constructor' would otherwise parse as a valid strategy.
  return raw !== null && raw !== undefined && Object.prototype.hasOwnProperty.call(COMPARATORS, raw)
    ? (raw as AssignmentStrategy)
    : null;
}
