import { currentWorkspaceId } from './context';

/**
 * The workspaceId actually being enforced, or undefined when nothing is. Delegates to
 * `currentWorkspaceId()` so this agrees with the stamper and the ACL extension.
 */
export function getCurrentWorkspaceId(): string | undefined {
  return currentWorkspaceId() ?? undefined;
}

// Relocated to bypassAcl/tenantUtils.ts — it runs under runAsSystem, so it belongs with the
// other ACL-bypassing code, not here. Re-exported so existing imports don't need to change.
export { resolveWorkspaceIdFromModel } from '@/bypassAcl/tenantUtils';

/**
 * Returns the workspaceId from the primary entity if available, otherwise from a fallback.
 * The fallback can be another entity or a function that returns a workspaceId.
 */
export function resolveWorkspaceIdWithFallback(
  primary: { workspaceId?: string | null } | null | undefined,
  fallback: (() => string | null | undefined) | { workspaceId?: string | null } | null | undefined,
): string | undefined {
  if (primary?.workspaceId) {
    return primary.workspaceId;
  }
  if (typeof fallback === 'function') {
    return fallback() ?? undefined;
  }
  return fallback?.workspaceId ?? undefined;
}
