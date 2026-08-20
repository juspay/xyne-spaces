import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAllChannels } from './useChannels';
import { useUsers, searchUsers } from './useUsers';
import { useAuthContextValues } from './useAuth';
import { useAffinityCallback } from './useAffinityCallback';
import { rankChannelsByAffinity } from './useSearchMetrics';
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
  // imperatively inside rankChannelsByAffinity, so a post-mount fetch is otherwise invisible).
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

    // Support comma-separated keywords (same as cmd+k via useSearchMetrics)
    const keywords = dmSearchQuery
      .toLowerCase()
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);

    const currentUserName = usersById.get(currentUserId)?.name?.toLowerCase() ?? '';
    const shouldMatchSelfDm = keywords.some(k => k === 'self' || currentUserName.includes(k));

    const isSelfDm = (dm: Channel): boolean => {
      const ids = parseDMParticipantIds(dm);
      return ids.length > 0 && ids.every(id => id === currentUserId);
    };

    const matchedDms = allChannels.filter(channel => {
      if (!isDMChannel(channel.scopeType)) return false;
      if (shouldMatchSelfDm && isSelfDm(channel)) return true;

      const participantNames = parseDMParticipantIds(channel)
        .filter(id => id !== currentUserId)
        .map(id => usersById.get(id)?.name?.toLowerCase())
        .filter((name): name is string => !!name);

      return keywords.some(keyword => participantNames.some(name => name.includes(keyword)));
    });

    // Flat recency (most recent first). rankChannelsByAffinity floats higher-weight DMs up while
    // its stable sort preserves this order within each weight tier.
    const byRecency = (a: Channel, b: Channel): number => b.lastActivityAt - a.lastActivityAt;

    const oneToOneMatches = matchedDms
      .filter(dm => isOneToOneDMChannel(dm.scopeType))
      .sort(byRecency);
    const groupMatches = matchedDms.filter(dm => isGroupDMChannel(dm.scopeType)).sort(byRecency);

    const rankedOneToOne = rankChannelsByAffinity(oneToOneMatches);
    // Pin the self-DM to the top of the Direct Messages section when searching "self"/own name.
    const oneToOne = shouldMatchSelfDm
      ? [...rankedOneToOne.filter(isSelfDm), ...rankedOneToOne.filter(dm => !isSelfDm(dm))]
      : rankedOneToOne;

    return {
      oneToOneDmResults: oneToOne,
      groupDmResults: rankChannelsByAffinity(groupMatches),
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
