import { useMemo } from 'react';
import type { User } from '@xyne/shared/machines';
import { useActiveUsers, useActiveUserSearch, useDmAffinityRank } from '@xyne/shared/hooks';

/**
 * User picker search for the compose-DM drawer.
 *
 * Mirrors the dashboard's ComposeDmPanel behaviour:
 *  - Deactivated users are excluded upstream (useActiveUserSearch/useActiveUsers).
 *  - Empty query: users ordered by most-recent DM activity (top `limit`).
 *  - With query: fuzzy search results, DM partners sorted first via `useDmAffinityRank`.
 *  - Current user is always filtered out.
 */
export const useDmPickerSearch = (
  query: string,
  limit: number,
  currentUserId: string | undefined,
): User[] => {
  const searchResults = useActiveUserSearch(query, limit);
  const allActiveUsers = useActiveUsers();
  const dmPartnerIds = useDmAffinityRank(currentUserId);

  return useMemo(() => {
    const usersById = new Map(allActiveUsers.map(u => [u.id, u]));
    const trimmed = query.trim();

    if (!trimmed) {
      return dmPartnerIds
        .filter(id => id !== currentUserId)
        .map(id => usersById.get(id))
        .filter((u): u is User => u !== undefined)
        .slice(0, limit);
    }

    const dmRank = new Map(dmPartnerIds.map((id, idx) => [id, idx]));
    return searchResults
      .filter(u => u.id !== currentUserId)
      .sort((a, b) => (dmRank.get(a.id) ?? Infinity) - (dmRank.get(b.id) ?? Infinity));
  }, [allActiveUsers, currentUserId, dmPartnerIds, limit, query, searchResults]);
};
