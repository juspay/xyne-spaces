import { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react';
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
  /** True while the deferred results lag behind the typed query. */
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
  // Input stays instant; the heavy filter memos below run off the deferred (background) render.
  const [dmSearchQuery, setDmSearchQuery] = useState('');
  const deferredQuery = useDeferredValue(dmSearchQuery);
  const trimmedQuery = deferredQuery.trim();
  const isSearchStale = trimmedQuery !== dmSearchQuery.trim();
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

  // Worker-based user search: fuzzy matching runs off the main thread.
  // Use a generous limit so DM contacts are not accidentally sliced out before
  // the DM-specific filter below runs.
  const workerUserResults = useWorkerUserSearch(dmSearchQuery, 500);

  const peopleResults = useMemo((): DmPersonResult[] => {
    void affinityVersion;
    if (!trimmedQuery) return [];
    const trimmed = trimmedQuery;
    const isSelfSearch = trimmed.toLowerCase() === 'self';
    const eligible = workerUserResults.filter(
      user =>
        oneToOneDmByUserId.has(user.id) ||
        (user.status === UserStatus.ACTIVE && user.userType === UserType.USER) ||
        (isSelfSearch && user.id === currentUserId),
    );
    let newPeopleLeft = PEOPLE_LIMIT;
    return rankUsers(eligible, trimmed, dmContactRecency)
      .filter(user => oneToOneDmByUserId.has(user.id) || newPeopleLeft-- > 0)
      .map(user => ({ user, channelId: oneToOneDmByUserId.get(user.id)?.id ?? null }));
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
  const workerChannelResults = useWorkerChannelSearch(groupItems, dmSearchQuery);

  const groupDmResults = useMemo(() => {
    if (!trimmedQuery) return [];

    // Referenced so this memo re-runs when affinity weights land (read imperatively inside
    // filterChannelsBySearchableNames, which useWorkerChannelSearch calls).
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

    return [...workerChannelResults.map(item => item.channel), ...emailMatched];
  }, [workerChannelResults, groupItems, trimmedQuery, affinityVersion]);

  // Autofocus search input when navigating to DM page
  useEffect(() => {
    dmSearchInputRef.current?.focus();
  }, []);

  const totalResultCount = peopleResults.length + groupDmResults.length;

  // Render-time derived-state reset: selection resets when the settled query changes, without
  // the extra per-keystroke render a reset effect would commit.
  const [indexResetQuery, setIndexResetQuery] = useState(deferredQuery);
  if (indexResetQuery !== deferredQuery) {
    setIndexResetQuery(deferredQuery);
    if (selectedDmSearchIndex !== 0) setSelectedDmSearchIndex(0);
  }

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

  return {
    dmSearchQuery,
    setDmSearchQuery,
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
