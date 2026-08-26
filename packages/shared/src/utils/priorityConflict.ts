/**
 * Shared rules for the per-channel priority conflict flow.
 *
 * These predicates are the single definition of "which tickets can contend for a place in the
 * queue" and "which tasks can be jumped ahead of". They are enforced on every write path:
 * the REST create path (backend priorityConflictService.validateIntake) and the Zero
 * claim mutator (post-creation / escalation), which must agree or a client could raise claims
 * the create path would have rejected.
 */

/**
 * Defensive upper bound on how many PENDING claims a single ticket may carry. The claim mutator
 * withdraws the previous one before inserting a new one, so a well-behaved client never exceeds
 * 1; this only stops a buggy or hostile client turning one mutation into an unbounded write.
 */
export const MAX_OPEN_PRIORITY_CLAIMS = 10;

/** Priorities that contend for a place in the queue and so trigger the negotiation. */
export const NEGOTIATED_PRIORITIES: readonly string[] = ['HIGH', 'CRITICAL'];

/** Ticket states that still represent live work, and so can be jumped ahead of. */
export const SUPERSEDABLE_STATUSES: readonly string[] = ['TODO', 'STARTED', 'PAUSED'];

export function isNegotiatedPriority(priority: string | null | undefined): boolean {
  return !!priority && NEGOTIATED_PRIORITIES.includes(priority);
}

export function isSupersedableStatus(statusV2: string | null | undefined): boolean {
  return !!statusV2 && SUPERSEDABLE_STATUSES.includes(statusV2);
}
