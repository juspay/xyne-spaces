import type { Action } from '@xyne/workflow-sdk';

/**
 * Whether `action` is permitted, given a resource's `permittedActions` (from
 * the authorizer, attached to single-fetch DTOs by the SDK runtime).
 *
 * When `permittedActions` is `undefined` — list rows (not computed to avoid an
 * N+1), or no authorizer configured — this returns `true`: the UI shows the
 * control optimistically and the backend still enforces. A denied attempt comes
 * back as a 403, surfaced by the mutation hooks. So this gates the UI for UX; it
 * is never the security boundary.
 */
export function canPerform(
  permittedActions: readonly Action[] | undefined,
  action: Action,
): boolean {
  return permittedActions === undefined || permittedActions.includes(action);
}

/**
 * True when an error from the workflow client is an authorization denial (403).
 * `WorkflowClientError` carries `.status`; a denied mutation surfaces here even
 * when the UI showed the control optimistically (list rows).
 */
export function isPermissionDenied(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status?: number }).status === 403
  );
}

/** A user-facing message for a mutation error, normalizing 403s. */
export function friendlyMutationError(err: unknown): string {
  if (isPermissionDenied(err)) return "You don't have permission to perform this action.";
  return err instanceof Error ? err.message : String(err);
}
