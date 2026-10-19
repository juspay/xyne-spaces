/**
 * The hub's Add members rule, applied to agents too. Mirrors the `addParticipants`
 * Zero mutator: no stats row means EVERYONE, and under ADMINS_ONLY a MEMBER may not add.
 * Kept free of @xyne/shared so it can be unit tested under the CJS jest setup.
 */
export function canAddHubMembers(
  role: string | null | undefined,
  addUserPolicy: string | null | undefined
): boolean {
  if (!role) return false;
  if ((addUserPolicy ?? 'EVERYONE') === 'ADMINS_ONLY') return role === 'ADMIN';
  return true;
}
