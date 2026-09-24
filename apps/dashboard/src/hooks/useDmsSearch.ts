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

  const hasQuery = dmSearchQuery.trim().length > 0;

  const peoplePool = useMemo(
    () =>
      hasQuery
        ? [...allUsers].sort((a, b) => getUserDisplayName(a).localeCompare(getUserDisplayName(b)))
        : [],
    [allUsers, hasQuery],
  );

  const peopleResults = useMemo((): DmPersonResult[] => {
    void affinityVersion;
    const trimmed = dmSearchQuery.trim();
    if (!trimmed) return [];
    const isSelfSearch = trimmed.toLowerCase() === 'self';
    const matched = peoplePool.filter(
      user =>
        (oneToOneDmByUserId.has(user.id) ||
          (user.status === UserStatus.ACTIVE && user.userType === UserType.USER)) &&
        (matchesUserQuery(user, trimmed) || (isSelfSearch && user.id === currentUserId)),
    );
    let newPeopleLeft = PEOPLE_LIMIT;
    return rankUsers(matched, trimmed, dmContactRecency)
      .filter(user => oneToOneDmByUserId.has(user.id) || newPeopleLeft-- > 0)
      .map(user => ({ user, channelId: oneToOneDmByUserId.get(user.id)?.id ?? null }));
  }, [
    peoplePool,
    dmSearchQuery,
    dmContactRecency,
    oneToOneDmByUserId,
    currentUserId,
    affinityVersion,
  ]);

  const groupDmResults = useMemo(() => {
    if (!dmSearchQuery.trim()) return [];

    // Referenced so this memo re-runs when affinity weights land (read imperatively below).
    void affinityVersion;

    const query = dmSearchQuery.trim().toLowerCase();

    // Match DMs with the SAME fuzzy, per-token, cross-participant matcher cmd+k uses
    // (filterChannelsBySearchableNames → one Fuse over participant docs, AND across query tokens).
    // Each participant contributes BOTH its displayName and raw name, so a full-name query matches
    // even when the displayName is a short nickname — the same names getDMNames(...).search builds.
    const groupItems = allChannels
      .filter(channel => isGroupDMChannel(channel.scopeType))
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
    const nameMatched = filterChannelsBySearchableNames(groupItems, dmSearchQuery);
    const nameMatchedIds = new Set(nameMatched.map(item => item.channel.id));

    // Email-only matches (participant email substring, no name match): cmd+k finds emails via People,
    // which the DM screen can't fall back to for existing contacts, so keep them here — appended
    // after the relevance-ranked name matches, ordered by recency.
    const byRecency = (a: Channel, b: Channel): number => b.lastActivityAt - a.lastActivityAt;
    const emailMatched = groupItems
      .map(item => item.channel)
      .filter(channel => {
        if (nameMatchedIds.has(channel.id)) return false;
        const emailHaystack = parseDMParticipantIds(channel)
          .filter(id => id !== currentUserId)
          .map(id => usersById.get(id)?.email ?? '')
          .join(' ')
          .toLowerCase();
        return emailHaystack.includes(query);
      })
      .sort(byRecency);

    return [...nameMatched.map(item => item.channel), ...emailMatched];
  }, [allChannels, dmSearchQuery, usersById, currentUserId, affinityVersion]);

  // Autofocus search input when navigating to DM page
  useEffect(() => {
    dmSearchInputRef.current?.focus();
  }, []);

  const totalResultCount = peopleResults.length + groupDmResults.length;

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
