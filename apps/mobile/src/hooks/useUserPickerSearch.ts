import { useMemo } from 'react';
import type { User } from '@xyne/shared/machines';

import { useUserSearch } from './useUsers';

/** Search hits for user pickers (includes deactivated users so UI can disable them). */
export type UserPickerSearchResults = User[];

/**
 * User search for pickers (DM, instant call, invites).
 * Includes deactivated users so the UI can show them as disabled.
 */
export const useUserPickerSearch = (
  query: string,
  limit: number,
  excludeUserId?: string | null,
): UserPickerSearchResults => {
  const results = useUserSearch(query, limit);

  return useMemo(() => {
    if (!excludeUserId) return results;
    return results.filter(user => user.id !== excludeUserId);
  }, [excludeUserId, results]);
};
