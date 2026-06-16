/**
 * Shared utilities for stage transition logic used across kanban, ticket details, and stage picker.
 */

interface TransitionLike {
  fromStageId?: string | null;
  toStageId: string;
  formId?: string | null;
  requiresApproval?: boolean;
  transitionApprovers?: ReadonlyArray<{
    userId: string | null;
    roleId: string | null;
    approverType: 'USER' | 'ROLE';
  }>;
}

/**
 * Returns true when the current stage has outgoing transitions configured.
 * A stage with no configured paths is unrestricted (unrestricted stages should not be blocked).
 */
export function isCurrentStageRestricted(
  transitions: ReadonlyArray<TransitionLike>,
  currentStageId: string,
): boolean {
  return transitions.some(t => t.fromStageId === currentStageId);
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
 * Returns null when the current stage is unrestricted (no transitions configured from it).
 */
export function getReachableStageIds(
  transitions: ReadonlyArray<TransitionLike>,
  currentStageId: string,
): Set<string> | null {
  if (!isCurrentStageRestricted(transitions, currentStageId)) return null;

  const ids = new Set(
    transitions.filter(t => t.fromStageId === currentStageId).map(t => t.toStageId),
  );

  return ids.size > 0 ? ids : null;
}
