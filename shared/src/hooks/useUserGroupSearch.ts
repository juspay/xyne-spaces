import { useMemo } from 'react';
import { useQuery } from './useQuery.js';
import { queries } from '../zero/queries.js';

export interface UserGroupLike {
  id: string;
  name: string;
  alias: string | null;
  description: string | null;
  isActive?: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Search & filter user groups by query string. Returns all groups (including
 * deactivated) so callers can render deactivated state; sorted by name.
 */
export const useUserGroupSearch = (
  searchQuery: string,
  limit: number = 10,
): UserGroupLike[] => {
  const [allUserGroups, details] = useQuery(queries.getAllUserGroups());
  return useMemo(() => {
    if (details.type !== 'complete') return [];
    if (!allUserGroups || allUserGroups.length === 0) return [];

    let filtered: UserGroupLike[];
    if (!searchQuery.trim()) {
      filtered = [...allUserGroups].sort((a, b) => a.name.localeCompare(b.name));
    } else {
      const q = searchQuery.toLowerCase();
      filtered = allUserGroups
        .filter(g => {
          const matchesName = g.name.toLowerCase().includes(q);
          const matchesAlias = g.alias?.toLowerCase().includes(q);
          return matchesName || matchesAlias;
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return filtered.slice(0, limit);
  }, [allUserGroups, details.type, searchQuery, limit]);
};
