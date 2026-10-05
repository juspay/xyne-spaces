import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { useAllChannels } from './useChannels';
import { useUsers } from './useUsers';
import { useAuthContextValues } from './useAuth';
import { useAffinityCallback } from './useAffinityCallback';
import { useDmContactRecency } from './useRankedPeopleSearch';
import { rankUsers } from '../utils/rankingUtils';
import {
  isGroupDMChannel,
  isOneToOneDMChannel,
  parseDMParticipantIds,
} from '../components/Chat/ChatDirectory/ChatDirectory.utils';
import { Channel, User, UserStatus, UserType } from '@xyne/shared';
import { useWorkerUserSearch } from './useWorkerUserSearch';
import { useWorkerChannelSearch } from './useWorkerChannelSearch';

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
  /** True while the workers haven't yet replied for the current query. */
  isSearchStale: boolean;
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
  const keystrokeTimeRef = useRef<number>(0);

  const setDmSearchQueryTimed = useCallback((query: string) => {
    keystrokeTimeRef.current = performance.now();
    setDmSearchQuery(query);
  }, []);

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

  // Worker-based user search: fuzzy matching runs off the main thread.
  // Use a generous limit so DM contacts are not accidentally sliced out before
  // the DM-specific filter below runs.
  const { results: workerUserResults, settledQuery: userSettledQuery } = useWorkerUserSearch(
    dmSearchQuery,
    500,
  );

  const peopleResults = useMemo((): DmPersonResult[] => {
    void affinityVersion;
    if (!trimmedQuery) return [];
    const t0 = performance.now();
    const isSelfSearch = trimmedQuery.toLowerCase() === 'self';
    const eligible = workerUserResults.filter(
      user =>
        oneToOneDmByUserId.has(user.id) ||
        (user.status === UserStatus.ACTIVE && user.userType === UserType.USER) ||
        (isSelfSearch && user.id === currentUserId),
    );
    let newPeopleLeft = PEOPLE_LIMIT;
    const result = rankUsers(eligible, trimmedQuery, dmContactRecency)
      .filter(user => oneToOneDmByUserId.has(user.id) || newPeopleLeft-- > 0)
      .map(user => ({ user, channelId: oneToOneDmByUserId.get(user.id)?.id ?? null }));
    console.log(`[PERF] peopleResults (rank worker hits): ${(performance.now() - t0).toFixed(2)}ms — ${result.length} results from ${workerUserResults.length} worker hits`);
    return result;
  }, [
    workerUserResults,
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

  // Worker-based channel search: regular-channel Fuse runs in a web worker;
  // group-DM participant matching still runs on the main thread inside the hook
  // (same as filterChannelsBySearchableNames) since DM docs are excluded from the worker.
  const { results: workerChannelResults, settledQuery: channelSettledQuery } =
    useWorkerChannelSearch(groupItems, dmSearchQuery);

  const groupDmResults = useMemo(() => {
    if (!trimmedQuery) return [];

    // Referenced so this memo re-runs when affinity weights land (read imperatively inside
    // filterChannelsBySearchableNames).
    void affinityVersion;

    const query = trimmedQuery.toLowerCase();
    const nameMatchedIds = new Set(workerChannelResults.map(item => item.channel.id));

    // Email-only matches (participant email substring, no name match): cmd+k finds emails via People,
    // which the DM screen can't fall back to for existing contacts, so keep them here — appended
    // after the relevance-ranked name matches, ordered by recency.
    const byRecency = (a: Channel, b: Channel): number => b.lastActivityAt - a.lastActivityAt;
    const emailMatched = groupItems
      .filter(item => !nameMatchedIds.has(item.channel.id) && item.emailHaystack.includes(query))
      .map(item => item.channel)
      .sort(byRecency);

    const result = [...workerChannelResults.map(item => item.channel), ...emailMatched];
    console.log(`[PERF] groupDmResults (email fallback): ${result.length} total (${workerChannelResults.length} worker + ${emailMatched.length} email)`);
    return result;
  }, [workerChannelResults, groupItems, trimmedQuery, affinityVersion]);

  // Autofocus search input when navigating to DM page
  useEffect(() => {
    dmSearchInputRef.current?.focus();
  }, []);

  const totalResultCount = peopleResults.length + groupDmResults.length;

  // Stale until both workers have replied for the current raw query.
  const isSearchStale =
    trimmedQuery.length > 0 &&
    (userSettledQuery !== dmSearchQuery || channelSettledQuery !== dmSearchQuery);

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
        // Don't act on stale results while the deferred render lags the typed query.
        if (isSearchStale) return;
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
    [peopleResults, groupDmResults, selectedDmSearchIndex, totalResultCount, isSearchStale],
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

  useLayoutEffect(() => {
    if (keystrokeTimeRef.current > 0 && trimmedQuery) {
      const elapsed = performance.now() - keystrokeTimeRef.current;
      console.log(`[PERF] keystroke→DOM update: ${elapsed.toFixed(2)}ms (query="${dmSearchQuery}")`);
      keystrokeTimeRef.current = 0;
    }
  }, [peopleResults, groupDmResults, dmSearchQuery, trimmedQuery]);

  return {
    dmSearchQuery,
    setDmSearchQuery: setDmSearchQueryTimed,
    peopleResults,
    groupDmResults,
    totalResultCount,
    isSearchStale,
    showDmSearchDropdown,
    setShowDmSearchDropdown,
    selectedDmSearchIndex,
    dmSearchInputRef,
    handleDmSearchKeyDown,
  };
};
