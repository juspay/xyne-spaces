/**
 * Stable partition that floats channel members to the top of an assignee list
 * and demotes non-members to the bottom (the same "last bucket" treatment we
 * give deactivated users).
 *
 * Non-members are kept, not removed: a person who has left the channel may
 * still be the current assignee and there is no auto-unassign, so they must
 * remain selectable — just lower down. Order within each group is preserved
 * (stable sort), and the whole thing is a no-op when no members are known
 * (e.g. the ticket has no channel, or participants haven't loaded yet).
 */
export function channelMembersFirst<T>(
  items: T[],
  getUserId: (item: T) => string | null | undefined,
  memberIds: Set<string>,
): T[] {
  if (memberIds.size === 0) return items;

  const members: T[] = [];
  const nonMembers: T[] = [];
  for (const item of items) {
    const userId = getUserId(item);
    if (userId && memberIds.has(userId)) {
      members.push(item);
    } else {
      nonMembers.push(item);
    }
  }
  return [...members, ...nonMembers];
}

/**
 * Floats the current user to the very top of a list — above channel members
 * and everyone else. Stable, so the ordering of the remaining items is kept.
 * A no-op when no current-user id is known. Apply this AFTER channelMembersFirst
 * so "you" sits above the members.
 */
export function currentUserFirst<T>(
  items: T[],
  getUserId: (item: T) => string | null | undefined,
  currentUserId: string | null | undefined,
): T[] {
  if (!currentUserId) return items;
  return channelMembersFirst(items, getUserId, new Set([currentUserId]));
}
