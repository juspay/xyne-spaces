import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAllChannels } from './useChannels';
import { useUsers } from './useUsers';
import { useAuthContextValues } from './useAuth';
import { useAffinityCallback } from './useAffinityCallback';
import { useDmContactRecency } from './useRankedPeopleSearch';
import { filterChannelsBySearchableNames, rankUsers } from '../utils/rankingUtils';
import { getUserDisplayName, matchesUserQuery } from '../utils/userDisplayName';
import {
  isGroupDMChannel,
  isOneToOneDMChannel,
  parseDMParticipantIds,
} from '../components/Chat/ChatDirectory/ChatDirectory.utils';
import { Channel, User, UserStatus, UserType } from '@xyne/shared';

const PEOPLE_LIMIT = 20;

export interface DmPersonResult {
  user: User;
  channelId: string | null;
}

interface UseDmsSearchReturn {
  dmSearchQuery: string;
  setDmSearchQuery: (query: string) => void;
  peopleResults: DmPersonResult[];
  /** Matching group DM channels, ranked by affinity */
  groupDmResults: Channel[];
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
  const trimmedQuery = dmSearchQuery.trim();
  const [showDmSearchDropdown, setShowDmSearchDropdown] = useState(false);
  const [selectedDmSearchIndex, setSelectedDmSearchIndex] = useState(0);
  const dmSearchInputRef = useRef<HTMLInputElement>(null);

  const allChannels = useAllChannels();
  const allUsers = useUsers();
  const { userID: currentUserId } = useAuthContextValues();
  const dmContactRecency = useDmContactRecency();
  // Re-render once affinity weights finish loading so the DM ranking memo re-runs (weights are read
  // imperatively inside filterChannelsBySearchableNames, so a post-mount fetch is otherwise invisible).
  const affinityVersion = useAffinityCallback();

  // Build a Map for O(1) user lookup (same as cmd+k approach in ChannelCommandMenu)
  const usersById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);

  const oneToOneDmByUserId = useMemo(() => {
    const map = new Map<string, Channel>();
    for (const channel of allChannels) {
      if (!isOneToOneDMChannel(channel.scopeType)) continue;
      const ids = parseDMParticipantIds(channel);
      if (!ids.includes(currentUserId)) continue;
      const partnerId =
        ids.find(id => id !== currentUserId) ?? (ids.length > 0 ? currentUserId : undefined);
      if (!partnerId) continue;
      const existing = map.get(partnerId);
      if (!existing || channel.lastActivityAt > existing.lastActivityAt) {
        map.set(partnerId, channel);
      }
    }
    return map;
  }, [allChannels, currentUserId]);

  // People match with the plain token-AND predicate (same as the pickers) — synchronous, so
  // results are always in sync with the typed query. Sorted once per user-list change so
  // rankUsers' stable sort keeps non-DM users in a stable alphabetical order.
  const hasQuery = trimmedQuery.length > 0;
  const peoplePool = useMemo(
    () =>
      hasQuery
        ? [...allUsers].sort((a, b) => getUserDisplayName(a).localeCompare(getUserDisplayName(b)))
        : [],
    [allUsers, hasQuery],
  );

  const peopleResults = useMemo((): DmPersonResult[] => {
    void affinityVersion;
    if (!trimmedQuery) return [];
    const isSelfSearch = trimmedQuery.toLowerCase() === 'self';
    const matched = peoplePool.filter(
      user =>
        (oneToOneDmByUserId.has(user.id) ||
          (user.status === UserStatus.ACTIVE && user.userType === UserType.USER)) &&
        (matchesUserQuery(user, trimmedQuery) || (isSelfSearch && user.id === currentUserId)),
    );
    let newPeopleLeft = PEOPLE_LIMIT;
    return rankUsers(matched, trimmedQuery, dmContactRecency)
      .filter(user => oneToOneDmByUserId.has(user.id) || newPeopleLeft-- > 0)
      .map(user => ({ user, channelId: oneToOneDmByUserId.get(user.id)?.id ?? null }));
  }, [
    peoplePool,
    trimmedQuery,
    dmContactRecency,
    oneToOneDmByUserId,
    currentUserId,
    affinityVersion,
  ]);

  // Query-independent inputs to the group-DM matcher, hoisted so they (and the Fuse-doc cache
  // in rankingUtils, keyed on this array's identity) rebuild only when the channel/user set changes.
  const groupItems = useMemo(
    () =>
      allChannels
        .filter(channel => isGroupDMChannel(channel.scopeType))
        .map(channel => {
          const participantIds = parseDMParticipantIds(channel).filter(id => id !== currentUserId);
          return {
            channel,
            searchableNames: participantIds.flatMap(id => {
              const u = usersById.get(id);
              return u ? [u.displayName, u.name].filter((n): n is string => !!n) : [];
            }),
            emailHaystack: participantIds
              .map(id => usersById.get(id)?.email ?? '')
              .join(' ')
              .toLowerCase(),
          };
        }),
    [allChannels, usersById, currentUserId],
  );

  // Group-DM participant matching runs on the main thread with the same matcher cmd+k uses
  // (filterChannelsBySearchableNames — one Fuse over participant-name docs, AND across query
  // tokens). DM channels match on participant names, not channel names, so the channel-search
  // worker (built for regular channels) has nothing to index here.
  const groupDmResults = useMemo((): Channel[] => {
    if (!trimmedQuery) return [];

    // Referenced so this memo re-runs when affinity weights land (read imperatively inside
    // filterChannelsBySearchableNames).
    void affinityVersion;

    const nameMatched = filterChannelsBySearchableNames(groupItems, trimmedQuery);
    const nameMatchedIds = new Set(nameMatched.map(item => item.channel.id));

    // Email-only matches (participant email substring, no name match): cmd+k finds emails via People,
    // which the DM screen can't fall back to for existing contacts, so keep them here — appended
    // after the relevance-ranked name matches, ordered by recency.
    const query = trimmedQuery.toLowerCase();
    const byRecency = (a: Channel, b: Channel): number => b.lastActivityAt - a.lastActivityAt;
    const emailMatched = groupItems
      .filter(item => !nameMatchedIds.has(item.channel.id) && item.emailHaystack.includes(query))
      .map(item => item.channel)
      .sort(byRecency);

    return [...nameMatched.map(item => item.channel), ...emailMatched];
  }, [groupItems, trimmedQuery, affinityVersion]);

  // Autofocus search input when navigating to DM page
  useEffect(() => {
    dmSearchInputRef.current?.focus();
  }, []);

  const totalResultCount = peopleResults.length + groupDmResults.length;

  // Reset selection on every query change.
  useEffect(() => {
    setSelectedDmSearchIndex(0);
  }, [dmSearchQuery]);

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
        if (selectedDmSearchIndex < peopleResults.length) {
          const person = peopleResults[selectedDmSearchIndex];
          if (person?.channelId) onSelectChannel(person.channelId);
          else if (person) onSelectUser(person.user.id);
        } else {
          const selectedGroup = groupDmResults[selectedDmSearchIndex - peopleResults.length];
          if (selectedGroup) onSelectChannel(selectedGroup.id);
        }
      } else if (e.key === 'Escape') {
        setShowDmSearchDropdown(false);
        dmSearchInputRef.current?.blur();
      }
    },
    [peopleResults, groupDmResults, selectedDmSearchIndex, totalResultCount],
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
    peopleResults,
    groupDmResults,
    totalResultCount,
    showDmSearchDropdown,
    setShowDmSearchDropdown,
    selectedDmSearchIndex,
    dmSearchInputRef,
    handleDmSearchKeyDown,
  };
};
