import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAllChannels } from './useChannels';
import { useUsers, searchUsers } from './useUsers';
import { useAuthContextValues } from './useAuth';
import { useAffinityCallback } from './useAffinityCallback';
import { filterChannelsBySearchableNames } from '../utils/rankingUtils';
import {
  isDMChannel,
  isGroupDMChannel,
  isOneToOneDMChannel,
  parseDMParticipantIds,
} from '../components/Chat/ChatDirectory/ChatDirectory.utils';
import { Channel, ChannelScopeType, User } from '@xyne/shared';

interface UseDmsSearchReturn {
  dmSearchQuery: string;
  setDmSearchQuery: (query: string) => void;
  /** Existing DM channels matching the search query (1:1 then group, in render order) */
  dmChannelResults: Channel[];
  /** Matching 1:1 DM channels, ranked by affinity (self-DM pinned first) */
  oneToOneDmResults: Channel[];
  /** Matching group DM channels, ranked by affinity */
  groupDmResults: Channel[];
  /** Workspace users with no existing 1:1 DM matching the search query */
  userResults: User[];
  /** Combined count for keyboard navigation */
  totalResultCount: number;
  showDmSearchDropdown: boolean;
  setShowDmSearchDropdown: (show: boolean) => void;
  selectedDmSearchIndex: number;
  dmSearchInputRef: React.RefObject<HTMLInputElement | null>;
  handleDmSearchKeyDown: (
    e: React.KeyboardEvent<HTMLInputElement>,
    onSelectChannel: (channelId: string) => void,
    onSelectUser: (userId: string) => void,
  ) => void;
}

export const useDmsSearch = (): UseDmsSearchReturn => {
  const [dmSearchQuery, setDmSearchQuery] = useState('');
  const [showDmSearchDropdown, setShowDmSearchDropdown] = useState(false);
  const [selectedDmSearchIndex, setSelectedDmSearchIndex] = useState(0);
  const dmSearchInputRef = useRef<HTMLInputElement>(null);

  const allChannels = useAllChannels();
  const allUsers = useUsers();
  const { userID: currentUserId } = useAuthContextValues();
  // Re-render once affinity weights finish loading so the DM ranking memo re-runs (weights are read
  // imperatively inside filterChannelsBySearchableNames, so a post-mount fetch is otherwise invisible).
  const affinityVersion = useAffinityCallback();

  // Build a Map for O(1) user lookup (same as cmd+k approach in ChannelCommandMenu)
  const usersById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);

  /**
   * Existing DM channels matching the query, partitioned into 1:1 and group and each ranked by
   * affinity weight (flat recency as the tie-break). The two types render as separate sections,
   * so no cross-type ordering is needed here.
   */
  const { oneToOneDmResults, groupDmResults } = useMemo(() => {
    if (!dmSearchQuery.trim()) return { oneToOneDmResults: [], groupDmResults: [] };

    // Referenced so this memo re-runs when affinity weights land (read imperatively below).
    void affinityVersion;

    const query = dmSearchQuery.trim().toLowerCase();
    const currentUserName = usersById.get(currentUserId)?.name?.toLowerCase() ?? '';
    const shouldMatchSelfDm = query
      .split(/[\s,]+/)
      .filter(Boolean)
      .some(t => t === 'self' || currentUserName.includes(t));

    const isSelfDm = (dm: Channel): boolean => {
      const ids = parseDMParticipantIds(dm);
      return ids.length > 0 && ids.every(id => id === currentUserId);
    };

    // Match DMs with the SAME fuzzy, per-token, cross-participant matcher cmd+k uses
    // (filterChannelsBySearchableNames → one Fuse over participant docs, AND across query tokens).
    // Each participant contributes BOTH its displayName and raw name, so a full-name query matches
    // even when the displayName is a short nickname — the same names getDMNames(...).search builds.
    const dmItems = allChannels
      .filter(channel => isDMChannel(channel.scopeType))
      .map(channel => ({
        channel,
        searchableNames: parseDMParticipantIds(channel)
          .filter(id => id !== currentUserId)
          .flatMap(id => {
            const u = usersById.get(id);
            return u ? [u.displayName, u.name].filter((n): n is string => !!n) : [];
          }),
      }));
    // Keep filterChannelsBySearchableNames' own ordering (fuseScore − affinity), the SAME blended
    // relevance cmd+k uses, so a strong prefix match ("Rajesh") outranks a weak fuzzy match to a
    // higher-affinity contact. Re-ranking the matched set by pure affinity buried clean matches.
    const nameMatched = filterChannelsBySearchableNames(dmItems, dmSearchQuery);
    const nameMatchedIds = new Set(nameMatched.map(item => item.channel.id));

    // Email-only matches (participant email substring, no name match): cmd+k finds emails via People,
    // which the DM screen can't fall back to for existing contacts, so keep them here — appended
    // after the relevance-ranked name matches, ordered by recency.
    const byRecency = (a: Channel, b: Channel): number => b.lastActivityAt - a.lastActivityAt;
    const emailMatched = allChannels
      .filter(channel => {
        if (!isDMChannel(channel.scopeType) || nameMatchedIds.has(channel.id)) return false;
        const emailHaystack = parseDMParticipantIds(channel)
          .filter(id => id !== currentUserId)
          .map(id => usersById.get(id)?.email ?? '')
          .join(' ')
          .toLowerCase();
        return emailHaystack.includes(query);
      })
      .sort(byRecency);

    const orderedMatches: Channel[] = [...nameMatched.map(item => item.channel), ...emailMatched];

    // The self-DM is name-excluded (its only participant is you), so it never appears in the matched
    // set above; surface it explicitly when the query looks like "self"/your own name, pinned to the
    // top of the Direct Messages section.
    const selfDms = shouldMatchSelfDm
      ? allChannels.filter(ch => isOneToOneDMChannel(ch.scopeType) && isSelfDm(ch))
      : [];

    const oneToOneMatches = orderedMatches.filter(dm => isOneToOneDMChannel(dm.scopeType));

    return {
      oneToOneDmResults: shouldMatchSelfDm ? [...selfDms, ...oneToOneMatches] : oneToOneMatches,
      groupDmResults: orderedMatches.filter(dm => isGroupDMChannel(dm.scopeType)),
    };
  }, [allChannels, dmSearchQuery, usersById, currentUserId, affinityVersion]);

  /** Combined channel list in render order (1:1 then group) — drives keyboard nav + Enter dispatch. */
  const dmChannelResults = useMemo(
    () => [...oneToOneDmResults, ...groupDmResults],
    [oneToOneDmResults, groupDmResults],
  );

  // Autofocus search input when navigating to DM page
  useEffect(() => {
    dmSearchInputRef.current?.focus();
  }, []);
  /** User IDs already represented by an existing 1:1 DM channel with current user */
  const usersWithExistingDm = useMemo(() => {
    const existing1on1Dms = allChannels.filter(ch => ch.scopeType === ChannelScopeType.DM);
    const ids = new Set<string>();
    for (const dm of existing1on1Dms) {
      for (const id of parseDMParticipantIds(dm)) {
        ids.add(id);
      }
    }
    return ids;
  }, [allChannels]);

  /** Workspace users with no existing 1:1 DM, matching the query via Fuse.js */
  const userResults = useMemo(() => {
    if (!dmSearchQuery.trim()) return [];

    const isSelfSearch = dmSearchQuery.trim().toLowerCase() === 'self';

    const baseResults = searchUsers(allUsers, dmSearchQuery, 10).filter(
      u => u.id !== currentUserId && !usersWithExistingDm.has(u.id),
    );

    // Include current user when searching by their name or "self" keyword
    const currentUser = allUsers.find(u => u.id === currentUserId);
    if (currentUser && !usersWithExistingDm.has(currentUserId)) {
      const nameMatches = searchUsers([currentUser], dmSearchQuery, 1).length > 0;
      if (isSelfSearch || nameMatches) {
        return [currentUser, ...baseResults];
      }
    }

    return baseResults;
  }, [allUsers, dmSearchQuery, currentUserId, usersWithExistingDm]);

  const totalResultCount = dmChannelResults.length + userResults.length;

  // Reset selected index when results change
  useEffect(() => {
    setSelectedDmSearchIndex(0);
  }, [totalResultCount]);

  const handleDmSearchKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLInputElement>,
      onSelectChannel: (channelId: string) => void,
      onSelectUser: (userId: string) => void,
    ) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedDmSearchIndex(prev => (prev < totalResultCount - 1 ? prev + 1 : prev));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedDmSearchIndex(prev => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === 'Enter' && totalResultCount > 0) {
        e.preventDefault();
        if (selectedDmSearchIndex < dmChannelResults.length) {
          const selectedChannel = dmChannelResults[selectedDmSearchIndex];
          if (selectedChannel) onSelectChannel(selectedChannel.id);
        } else {
          const userIndex = selectedDmSearchIndex - dmChannelResults.length;
          const selectedUser = userResults[userIndex];
          if (selectedUser) onSelectUser(selectedUser.id);
        }
      } else if (e.key === 'Escape') {
        setShowDmSearchDropdown(false);
        dmSearchInputRef.current?.blur();
      }
    },
    [dmChannelResults, userResults, selectedDmSearchIndex, totalResultCount],
  );

  // Close dropdown when clicking outside the search container
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.dm-search-container')) {
        setShowDmSearchDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return {
    dmSearchQuery,
    setDmSearchQuery,
    dmChannelResults,
    oneToOneDmResults,
    groupDmResults,
    userResults,
    totalResultCount,
    showDmSearchDropdown,
    setShowDmSearchDropdown,
    selectedDmSearchIndex,
    dmSearchInputRef,
    handleDmSearchKeyDown,
  };
};
