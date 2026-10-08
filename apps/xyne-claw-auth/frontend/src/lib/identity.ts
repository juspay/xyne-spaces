/**
 * Current-user identity aliases.
 *
 * The SPA authenticates against the Spaces backend, whose `user.id` is the
 * workspace-scoped Spaces id. Claw-owned rows (Agent.ownerUserId,
 * Skill.ownerUserId, ClawAdmin.userId, connector ownerUserId, …) are keyed by
 * the canonical Claw id — and pre-canonicalization rows still carry the raw
 * Spaces id. Either form can legitimately mean "this is me".
 *
 * `useAuth` populates the alias set once at login (both id forms); every
 * ownership/identity comparison must go through `isCurrentUser` instead of
 * `=== userId`, or post-canonicalization users lose edit/share controls on
 * their own resources.
 */

let currentUserIds = new Set<string>();

export function setCurrentUserIds(ids: Array<string | null | undefined>): void {
  currentUserIds = new Set(
    ids
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

/** True when `id` is ANY wire representation of the logged-in user. */
export function isCurrentUser(id: string | null | undefined): boolean {
  return !!id && currentUserIds.has(id);
}
