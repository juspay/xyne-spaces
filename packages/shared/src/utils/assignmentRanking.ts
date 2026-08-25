// How a user group ranks its already-eligible members, shared by the backend
// engine (assignmentEngine.ts) and the dashboard's Visibility tab preview: the
// preview's whole job is to show who the engine picks next, so if the two
// orderings drift, the preview lies.
//
// Ranking is the ONLY thing a strategy decides — eligibility, the per-user
// maxTickets cap and the group maxWorkload cap are applied by the caller.

// `.js`: value import (the enum backs COMPARATORS at runtime) in an ESM package.
import { AssignmentStrategy } from '../zero/types.js';

/** Never-picked members sort ahead of everyone holding a real timestamp. */
export const NEVER_ASSIGNED_RANK = -1;

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
 * Cursor ties are the common case, not the edge case: everyone never picked
 * shares NEVER_ASSIGNED_RANK, and one batch's picks share a timestamp. So ties
 * break on lighter workload first — breaking on `userId` alone would hand every
 * tie to whoever sorts first alphabetically.
 */
const byLeastRecentlyAssigned: AssigneeComparator = (a, b) =>
  (a.lastAssignedAt ?? NEVER_ASSIGNED_RANK) - (b.lastAssignedAt ?? NEVER_ASSIGNED_RANK) ||
  a.weightedActiveTasks - b.weightedActiveTasks ||
  a.userId.localeCompare(b.userId);

/** Exhaustive: a new AssignmentStrategy fails to compile until ranked here. */
const COMPARATORS: Record<AssignmentStrategy, AssigneeComparator> = {
  [AssignmentStrategy.WORKLOAD]: byLowestScore,
  [AssignmentStrategy.ROUND_ROBIN]: byLeastRecentlyAssigned,
};

/** Best-first comparator for `strategy`. */
export function comparatorFor(strategy: AssignmentStrategy): AssigneeComparator {
  return COMPARATORS[strategy];
}

/**
 * Narrow a stored `user_groups.assignmentStrategy`. Returns null for anything
 * unrecognised (including groups predating the column) so the caller decides how
 * loudly to fall back — a group set to ROUND_ROBIN that quietly assigns by
 * workload is exactly the bug worth logging.
 */
export function parseAssignmentStrategy(raw: string | null | undefined): AssignmentStrategy | null {
  // hasOwnProperty, not `in`: `in` walks the prototype chain, so a stored
  // 'toString' or 'constructor' would otherwise parse as a valid strategy.
  return raw !== null && raw !== undefined && Object.prototype.hasOwnProperty.call(COMPARATORS, raw)
    ? (raw as AssignmentStrategy)
    : null;
}
