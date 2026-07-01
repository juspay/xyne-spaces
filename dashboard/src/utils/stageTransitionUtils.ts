/**
 * Shared utilities for stage transition logic used across kanban, ticket details, and stage picker.
 */

interface TransitionLike {
  fromStageId?: string | null;
  toStageId: string;
  formId?: string | null;
  requiresApproval?: boolean | null; // NULL treated as false in code
  transitionApprovers?: ReadonlyArray<{
    userId: string | null;
    roleId: string | null;
    approverType?: string | null; // NULL treated as USER in code
  }>;
}

/**
 * Returns the matching transition from currentStageId → targetStageId.
 */
export function findMatchingTransition<T extends TransitionLike>(
  transitions: ReadonlyArray<T>,
  currentStageId: string,
  targetStageId: string,
): T | undefined {
  return transitions.find(t => t.fromStageId === currentStageId && t.toStageId === targetStageId);
}

/**
 * Returns the set of stage IDs reachable from currentStageId.
 *
 * Returns `null` when the board has no transitions at all (no edge graph → unrestricted,
 * legacy). Otherwise returns the current stage's outgoing target IDs — which may be EMPTY
 * for a terminal stage. Callers must NOT treat an empty set as "unrestricted": only `null`
 * means unrestricted. An empty set means a stage that cannot move anywhere.
 */
export function getReachableStageIds(
  transitions: ReadonlyArray<TransitionLike>,
  currentStageId: string,
): Set<string> | null {
  // No transitions on the board → no edge graph → unrestricted.
  if (transitions.length === 0) return null;

  // Collect THIS stage's outgoing targets. Empty set = terminal stage.
  return new Set(transitions.filter(t => t.fromStageId === currentStageId).map(t => t.toStageId));
}
