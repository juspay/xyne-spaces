import { useMemo } from 'react';
import type { User } from '@xyne/shared';
import { ChannelScopeType } from '@xyne/shared';
import { useActiveUsers, useActiveUserSearch } from './useUsers';
import { useAllVisibleChannels } from './useChannels';
import { useAuthContextValues } from './useAuth';
import { useAffinityCallback } from './useAffinityCallback';
import { rankUsersWithMfu } from '../utils/rankingUtils';
import { matchesUserQuery } from '../utils/userDisplayName';

/**
 * Shared people-picker ranking recipe — the same trio cmd+K / slash pickers use:
 * full-name token matching (via `searchUsers`), MFU affinity, then DM recency.
 * Lets Compose and Forward converge on one implementation instead of bespoke recency sorts.
 */

/**
 * Map of 1:1 DM partner id → recency index (0 = most recent), from visible DM channels.
 * `rankUsers` reads it as the "frequent contact" signal and DM-recency tie-break.
 */
export function useDmContactRecency(): Map<string, number> {
  const { userID: currentUserId } = useAuthContextValues();
  const visibleChannels = useAllVisibleChannels();
  return useMemo(() => {
    const oneToOne = [...visibleChannels]
      .filter(ch => ch.scopeType === ChannelScopeType.DM)
      .sort(
        (a, b) => (b.channelStats?.lastActivityAt ?? 0) - (a.channelStats?.lastActivityAt ?? 0),
      );
    const map = new Map<string, number>();
    for (const ch of oneToOne) {
      const otherId = ch.name.split(',').find(id => id && id !== currentUserId);
      if (otherId && !map.has(otherId)) map.set(otherId, map.size);
    }
    return map;
  }, [visibleChannels, currentUserId]);
}

interface RankedPeopleOptions {
  /** Recovery pool for MFU recovery (default: active users). Slash passes `allUsers` to stay exact. */
  recoveryPool?: User[];
  /** DM-recency map override (default: `useDmContactRecency`). Slash passes its parent-built map. */
  dmContactRecency?: Map<string, number>;
  /** Drop from candidates AND recovery pool — slash `/call` self-exclusion. */
  excludeUserId?: string;
  /** Inject at rest so a self-DM stays reachable when the cap sliced it out — slash `/chat`. */
  ensureUserIdAtRest?: string;
  /** Seed DM contacts into the empty-query candidate set so the browse state shows recent partners. */
  seedDmContactsAtRest?: boolean;
  /** Substring fallback when Fuse returns nothing (1-char / gapped 2-char queries). */
  substringFallback?: boolean;
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
    seedDmContactsAtRest = true,
    substringFallback = true,
  } = opts;

  return useMemo(() => {
    // Re-rank once affinity weights load (rankUsersWithMfu reads getUserWeight imperatively).
    void affinityVersion;

    const trimmed = query.trim();
    const pool = recoveryPool ?? activeUsers;
    const recency = dmContactRecency ?? defaultRecency;

    // Fuse ignores <2-char and single-token queries; fall back to matchesUserQuery over the pool
    // (same matcher the pickers use) so short keystrokes still match.
    let candidates: User[] =
      substringFallback && trimmed.length > 0 && searchCandidates.length === 0
        ? pool.filter(u => matchesUserQuery(u, trimmed)).slice(0, limit)
        : searchCandidates;

    // `/call`: self can't be a target — remove from candidates and the recovery pool so
    // rankUsersWithMfu can't float a weighted self back in.
    let effectivePool = pool;
    if (excludeUserId) {
      candidates = candidates.filter(u => u.id !== excludeUserId);
      effectivePool = pool.filter(u => u.id !== excludeUserId);
    }

    // At rest, seed the recent DM partners so the browse list mirrors "people you talk to".
    // Build a new array — `candidates` may be the memoized useActiveUserSearch result; mutating it
    // would corrupt that memo across renders.
    if (!trimmed && seedDmContactsAtRest) {
      const byId = new Map(effectivePool.map(u => [u.id, u]));
      const present = new Set(candidates.map(u => u.id));
      const seeds: User[] = [];
      for (const id of recency.keys()) {
        if (present.has(id)) continue;
        const u = byId.get(id);
        if (u) {
          seeds.push(u);
          present.add(id);
        }
      }
      if (seeds.length > 0) candidates = [...candidates, ...seeds];
    }

    // `/chat`: inject self at rest so the self-DM stays reachable (ranked, not pinned).
    if (!trimmed && ensureUserIdAtRest && !candidates.some(u => u.id === ensureUserIdAtRest)) {
      const self = effectivePool.find(u => u.id === ensureUserIdAtRest);
      if (self) candidates = [...candidates, self];
    }

    return rankUsersWithMfu(candidates, effectivePool, query, recency);
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
