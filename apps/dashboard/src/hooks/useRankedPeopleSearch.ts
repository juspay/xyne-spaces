import { useMemo } from 'react';
import type { User } from '@xyne/shared';
import {
  buildVisibleDmContactRecency,
  rankActivePeople,
  type RankedPeopleOptions,
} from '@xyne/shared/utils';
import { useActiveUsers, useActiveUserSearch } from './useUsers';
import { useAllVisibleChannels } from './useChannels';
import { useAuthContextValues } from './useAuth';
import { useAffinityCallback } from './useAffinityCallback';
import { affinityService } from '../services/affinityService';

/**
 * Shared people-picker ranking recipe — the same trio cmd+K / slash pickers use:
 * full-name token matching (via `searchUsers`), MFU affinity, then DM recency.
 * Lets Compose and Forward converge on one implementation instead of bespoke recency sorts.
 * The ranking itself lives in `@xyne/shared` (`rankActivePeople`), shared with mobile.
 */

/**
 * Map of 1:1 DM partner id → recency index (0 = most recent), from visible DM channels.
 * `rankUsers` reads it as the "frequent contact" signal and DM-recency tie-break.
 */
export function useDmContactRecency(): Map<string, number> {
  const { userID: currentUserId } = useAuthContextValues();
  const visibleChannels = useAllVisibleChannels();
  return useMemo(
    () => buildVisibleDmContactRecency(visibleChannels, currentUserId),
    [visibleChannels, currentUserId],
  );
}

/**
 * Active-user candidates (`useActiveUserSearch`, which already embeds the `matchesAllTokens`
 * recall pass) ranked by `rankUsersWithMfu` (relevance tier → MFU affinity → DM recency).
 *
 * The "rich" behaviors (`seedDmContactsAtRest`, `substringFallback`) default ON for the picker
 * surfaces; slash pickers turn them off and pass the override opts so the swap is a no-op.
 */
export function useRankedActivePeople(
  query: string,
  limit: number,
  opts: RankedPeopleOptions = {},
): User[] {
  const activeUsers = useActiveUsers();
  const searchCandidates = useActiveUserSearch(query, limit);
  const defaultRecency = useDmContactRecency();
  const affinityVersion = useAffinityCallback();

  const {
    recoveryPool,
    dmContactRecency,
    excludeUserId,
    ensureUserIdAtRest,
    seedDmContactsAtRest,
    substringFallback,
  } = opts;

  return useMemo(() => {
    // Re-rank once affinity weights load (rankUsersWithMfu reads getUserWeight imperatively).
    void affinityVersion;

    return rankActivePeople(
      query,
      limit,
      activeUsers,
      searchCandidates,
      defaultRecency,
      {
        recoveryPool,
        dmContactRecency,
        excludeUserId,
        ensureUserIdAtRest,
        seedDmContactsAtRest,
        substringFallback,
      },
      userId => affinityService.getUserWeight(userId),
    );
  }, [
    query,
    limit,
    searchCandidates,
    activeUsers,
    defaultRecency,
    recoveryPool,
    dmContactRecency,
    excludeUserId,
    ensureUserIdAtRest,
    seedDmContactsAtRest,
    substringFallback,
    affinityVersion,
  ]);
}
