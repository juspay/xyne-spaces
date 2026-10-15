/**
 * Workspace resolution for Xyne Spaces deep links.
 *
 * A message deep link can carry scope segments ahead of the path
 * (`/<orgId>/<workspaceId>/chat/dir/<channelId>`, or just `/<workspaceId>/...`).
 * When the link points at a workspace other than the active one, the target channel
 * does not exist in the active workspace's local store, so opening it in place
 * resolves to nothing and the screen falls back to "This message is unavailable".
 * These helpers decide whether a workspace switch is required first.
 *
 * Rather than trusting a segment's position, the decision is made against the
 * workspaces the user is actually a member of: whichever scope segment names one of
 * them is the workspace to enter. That is correct no matter which order a link puts
 * org and workspace in, and it distinguishes "different workspace" from "a workspace
 * you are not in" — two cases that need very different handling. When the member list
 * is not available the last scope segment is used, since that is the workspace slot.
 *
 * The module is intentionally pure (no auth or Zero) so it can be unit tested
 * without those providers.
 */

import { messageDeepLinkScopeSegments, type DeepLinkScopePayload } from './messageDeepLinkCore';

export type DeepLinkWorkspace = {
  readonly id: string;
  readonly name: string;
};

export type DeepLinkWorkspaceDecision =
  /** Already in the right workspace (or the link names none) — open in place. */
  | { readonly action: 'open' }
  /** Enter `targetWorkspaceId` first, then open. `targetWorkspaceName` is present
   *  only when the workspace was matched against the member list. */
  | {
      readonly action: 'switch';
      readonly targetWorkspaceId: string;
      readonly targetWorkspaceName?: string;
    }
  /** The link names a workspace, the member list is known, and none of its scope
   *  segments is a workspace the user belongs to. Opening is impossible. */
  | { readonly action: 'unavailable' };

const normalize = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeSegments = (segments: readonly (string | null | undefined)[]): string[] =>
  segments.map(normalize).filter(segment => segment.length > 0);

/**
 * Decide whether opening a deep link requires switching the active workspace first.
 *
 * @param activeWorkspaceId Workspace the app is currently in, if known.
 * @param scopeSegments     Link scope segments in path order (workspace slot last).
 * @param memberWorkspaces  Workspaces the user belongs to, or `null` when the list
 *                          could not be loaded — the caller then gets a best-effort
 *                          decision from the last scope segment instead of a refusal.
 */
export function resolveDeepLinkWorkspaceDecision(
  activeWorkspaceId: string | null | undefined,
  scopeSegments: readonly (string | null | undefined)[],
  memberWorkspaces: readonly DeepLinkWorkspace[] | null = null,
): DeepLinkWorkspaceDecision {
  const segments = normalizeSegments(scopeSegments);
  if (segments.length === 0) {
    return { action: 'open' };
  }

  const active = normalize(activeWorkspaceId);
  if (active && segments.includes(active)) {
    return { action: 'open' };
  }

  if (memberWorkspaces === null) {
    // Unknown membership. The workspace slot is the last scope segment, and an
    // unknown active workspace (cold cache) is not enough to justify a switch.
    const target = segments[segments.length - 1] as string;
    return active ? { action: 'switch', targetWorkspaceId: target } : { action: 'open' };
  }

  // Search from the workspace slot outwards so the adjacent segment wins if a link
  // ever names both an org and a workspace the user happens to be a member of.
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index] as string;
    const match = memberWorkspaces.find(workspace => normalize(workspace.id) === segment);
    if (match) {
      return normalize(match.id) === active
        ? { action: 'open' }
        : { action: 'switch', targetWorkspaceId: match.id, targetWorkspaceName: match.name };
    }
  }

  return { action: 'unavailable' };
}

/**
 * Cheap synchronous gate for in-app link taps. True when the link names a scope
 * and none of its segments is the active workspace — i.e. the target lives in
 * another workspace and cannot be opened in place. Which workspace to enter
 * (and whether the user is a member) is decided by the root pipeline, which
 * both message and ticket taps enqueue into via `enqueueDeepLink`.
 *
 * Keep this aligned with `useDeepLinkWorkspaceSwitch.claim`: both treat "no
 * active workspace" and "active workspace is one of the scope segments" as
 * open-in-place.
 */
export function requiresWorkspaceSwitch(
  payload: DeepLinkScopePayload,
  activeWorkspaceId: string | null | undefined,
): boolean {
  const segments = messageDeepLinkScopeSegments(payload);
  if (segments.length === 0) return false;
  const active = normalize(activeWorkspaceId);
  if (!active) return false;
  return !segments.includes(active);
}

/**
 * Normalize an active-workspace value for link generation: a null, undefined, or
 * blank workspace id becomes `undefined` so the generated link omits the workspace
 * segment (graceful degradation) rather than emitting an empty one.
 */
export function normalizeWorkspaceIdForLink(
  workspaceId: string | null | undefined,
): string | undefined {
  const trimmed = normalize(workspaceId);
  return trimmed.length > 0 ? trimmed : undefined;
}
