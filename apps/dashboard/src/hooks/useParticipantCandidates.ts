import { useMemo } from 'react';
import type { UserGroupLike, VisibleChannel } from '@xyne/shared/hooks';
import { useUserGroupSearch } from '@xyne/shared/hooks';
import { searchChannels } from '@xyne/shared/utils';
import { rankChannelsByAffinity } from '../utils/rankingUtils';
import type { User } from '../machines/stateMachine';
import { searchUsers, useActiveUsers } from './useUsers';
import { useAllVisibleChannels } from './useChannels';
import { useRankedActivePeople } from './useRankedPeopleSearch';

/**
 * Bounded candidate source for the participant pickers.
 *
 * Returns at most `userLimit` / `userGroupLimit` / `channelLimit` **raw** entities,
 * already ranked for `query`. Callers decorate only what comes back.
 *
 * That ordering is the entire point. The call modals used to map the complete
 * workspace user list into option objects — each carrying two `<Avatar>` elements
 * and a `<ParticipantOptionContent>` — then `localeCompare`-sort it, then re-spread
 * all of it through a fresh Fuse index, on every keystroke. At 2k users that is
 * ~6k React elements and ~22k ICU comparisons per character typed. Applying the
 * limit *before* decoration is the same fix `UnifiedParticipantSearch` made for the
 * recording share modals (XYNE-59221); this hook is that fix in a form the call
 * modals can use, since they need picker features (`lockedValues`, the channel-member
 * unfurl, bulk paste) that `UnifiedParticipantSearch` does not expose.
 *
 * Ranking matches the rest of the app: `useRankedActivePeople` (token match → MFU
 * affinity → DM recency), the shared `searchChannels` matcher, and `useUserGroupSearch`.
 */
export interface ParticipantCandidateOptions {
  /** Current search text. Empty string = browse mode (still capped). */
  query: string;
  /** Hard cap on returned users. */
  userLimit?: number;
  /** Hard cap on returned user groups. */
  userGroupLimit?: number;
  /** Hard cap on returned channels. Ignored when `includeChannels` is false. */
  channelLimit?: number;
  /** Never offered — typically the current user plus anyone already committed. */
  excludeUserIds?: ReadonlySet<string>;
  /**
   * Restrict candidates to this set (thread-scoped pickers, where only members of
   * the originating channel may be invited). Ranking then runs over that pool
   * instead of the workspace, so a small allowlist still returns full results.
   * `null`/omitted = the whole workspace.
   */
  restrictToUserIds?: ReadonlySet<string> | null;
  /** Groups already fully represented by the current selection. */
  excludeUserGroupIds?: ReadonlySet<string>;
  /** Set false for pickers that only offer people (thread-scoped calls). */
  includeChannels?: boolean;
  /** Set false for pickers that only offer people (thread-scoped calls). */
  includeUserGroups?: boolean;
  /** Extra per-channel predicate, e.g. dropping Desk channels. Must be memoized. */
  channelFilter?: (channel: VisibleChannel) => boolean;
}

export interface ParticipantCandidates {
  users: User[];
  userGroups: UserGroupLike[];
  channels: VisibleChannel[];
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

/**
 * Visible-channel search. Deliberately NOT `useChannelSearch`, which searches
 * `useAllChannels()` — that includes channels the user cannot open. The call
 * pickers must only ever offer channels from `useAllVisibleChannels()`.
 */
function useVisibleChannelCandidates(
  query: string,
  limit: number,
  enabled: boolean,
  channelFilter: ((channel: VisibleChannel) => boolean) | undefined,
): VisibleChannel[] {
  const visibleChannels = useAllVisibleChannels();

  // Filter before ranking: the predicate is cheap and shrinks the Fuse corpus.
  const pool = useMemo(() => {
    if (!enabled) return [];
    return channelFilter ? visibleChannels.filter(channelFilter) : visibleChannels;
  }, [enabled, visibleChannels, channelFilter]);

  return useMemo(() => {
    if (pool.length === 0) return [];
    // Browse (no query): `searchChannels` would just `slice(0, limit)` in whatever
    // order the visible-channel list happens to be in — arbitrary once a workspace
    // has hundreds of channels. Rank by affinity + recency instead, the same
    // most-used-first ordering Cmd+K and the slash pickers use for their browse state.
    if (!query) return rankChannelsByAffinity(pool).slice(0, limit);
    return searchChannels(pool, query, limit);
  }, [pool, query, limit]);
}

export function useParticipantCandidates({
  query,
  userLimit = 20,
  userGroupLimit = 10,
  channelLimit = 10,
  excludeUserIds = EMPTY_IDS,
  restrictToUserIds = null,
  excludeUserGroupIds = EMPTY_IDS,
  includeChannels = true,
  includeUserGroups = true,
  channelFilter,
}: ParticipantCandidateOptions): ParticipantCandidates {
  const trimmedQuery = query.trim();
  const activeUsers = useActiveUsers();

  // Over-fetch by the exclusion count so filtering afterwards can still fill the cap.
  const userFetchLimit = userLimit + excludeUserIds.size;

  // Workspace-wide ranking. Always called (rules of hooks); its result is discarded
  // when `restrictToUserIds` is set. Both paths are memoized, so an unused pass costs
  // one Fuse index build over a list that is already indexed elsewhere in the app.
  const workspaceRanked = useRankedActivePeople(trimmedQuery, userFetchLimit);

  // Allowlist pool, rebuilt only when the roster changes — NOT per keystroke.
  const restrictedPool = useMemo(() => {
    if (!restrictToUserIds) return null;
    return activeUsers.filter(u => restrictToUserIds.has(u.id));
  }, [activeUsers, restrictToUserIds]);

  const restrictedRanked = useMemo(() => {
    if (!restrictedPool) return null;
    return searchUsers(restrictedPool, trimmedQuery, userFetchLimit);
  }, [restrictedPool, trimmedQuery, userFetchLimit]);

  const users = useMemo(() => {
    const ranked = restrictedRanked ?? workspaceRanked;
    const out: User[] = [];
    for (const user of ranked) {
      if (excludeUserIds.has(user.id)) continue;
      out.push(user);
      if (out.length >= userLimit) break;
    }
    return out;
  }, [restrictedRanked, workspaceRanked, excludeUserIds, userLimit]);

  const rawUserGroups = useUserGroupSearch(
    query,
    includeUserGroups ? userGroupLimit + excludeUserGroupIds.size : 0,
  );
  const userGroups = useMemo(() => {
    if (!includeUserGroups) return [];
    if (excludeUserGroupIds.size === 0) return rawUserGroups.slice(0, userGroupLimit);
    return rawUserGroups.filter(g => !excludeUserGroupIds.has(g.id)).slice(0, userGroupLimit);
  }, [rawUserGroups, excludeUserGroupIds, userGroupLimit, includeUserGroups]);

  const channels = useVisibleChannelCandidates(
    trimmedQuery,
    channelLimit,
    includeChannels,
    channelFilter,
  );

  return useMemo(() => ({ users, userGroups, channels }), [users, userGroups, channels]);
}
