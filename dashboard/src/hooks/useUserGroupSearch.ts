import { useMemo } from 'react';
import { useUserGroups } from './useUserGroup';

interface UserGroup {
  id: string;
  name: string;
  alias: string | null;
  description: string | null;
  isActive?: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Hook to search and filter user groups by query string
 * Returns all groups (including deactivated) - UI should show deactivated status
 * @param searchQuery - The search query to filter groups
 * @param limit - Maximum number of results to return
 * @returns Array of filtered user groups
 */
export const useUserGroupSearch = (searchQuery: string, limit: number = 10): UserGroup[] => {
  // Fetch all user groups
  const allUserGroups = useUserGroups();

  // Filter and search user groups
  const filteredGroups = useMemo(() => {
    if (!allUserGroups || allUserGroups.length === 0) {
      return [];
    }

    let filtered: UserGroup[];

    if (!searchQuery.trim()) {
      // No search query - return all groups sorted by name
      filtered = [...allUserGroups].sort((a: UserGroup, b: UserGroup) =>
        a.name.localeCompare(b.name),
      );
    } else {
      // Search query present - filter by name or alias
      const query = searchQuery.toLowerCase();
      filtered = allUserGroups
        .filter((group: UserGroup) => {
          const matchesName = group.name.toLowerCase().includes(query);
          const matchesAlias = group.alias?.toLowerCase().includes(query);
          return matchesName || matchesAlias;
        })
        .sort((a: UserGroup, b: UserGroup) => a.name.localeCompare(b.name));
    }

    // Limit results
    return filtered.slice(0, limit);
  }, [allUserGroups, searchQuery, limit]);

  return filteredGroups;
};
