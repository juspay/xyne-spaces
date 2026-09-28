import { useMemo } from "react";
import { useQuery } from "./useQuery.js";
import { queries } from "../zero/queries.js";
import { matchesAllTokens } from "../utils/index.js";

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
    if (details.type !== "complete") return [];
    if (!allUserGroups || allUserGroups.length === 0) return [];

    let filtered: UserGroupLike[];
    if (!searchQuery.trim()) {
      filtered = [...allUserGroups].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    } else {
      // Token match (multi-word, order-independent) on name and alias — same matching people get,
      // so "eng team" finds "Engineering Team".
      filtered = allUserGroups
        .filter(
          (g) =>
            matchesAllTokens(g.name, searchQuery) ||
            matchesAllTokens(g.alias ?? "", searchQuery),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return filtered.slice(0, limit);
  }, [allUserGroups, details.type, searchQuery, limit]);
};
