import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAllChannels } from './useChannels';
import { useUsers, searchUsers } from './useUsers';
import { useAuthContextValues } from './useAuth';
import {
  isDMChannel,
  parseDMParticipantIds,
} from '../components/Chat/ChatDirectory/ChatDirectory.utils';
import { Channel, ChannelScopeType, User } from '@xyne/shared';

interface UseDmsSearchReturn {
  dmSearchQuery: string;
  setDmSearchQuery: (query: string) => void;
  /** Existing DM channels matching the search query */
  dmChannelResults: Channel[];
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

  // Build a Map for O(1) user lookup (same as cmd+k approach in ChannelCommandMenu)
  const usersById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);

  /** Existing DM channels (1:1 and group) matching the query */
  const dmChannelResults = useMemo(() => {
    if (!dmSearchQuery.trim()) return [];

    // Support comma-separated keywords (same as cmd+k via useSearchMetrics)
    const keywords = dmSearchQuery
      .toLowerCase()
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);

    const dmChannels = allChannels.filter(channel => isDMChannel(channel.scopeType));

    return dmChannels
      .filter(dm => {
        const participantIds = parseDMParticipantIds(dm);
        const participantNames = participantIds
          .map(id => usersById.get(id)?.name?.toLowerCase())
          .filter((name): name is string => !!name);

        return keywords.some(keyword => participantNames.some(name => name.includes(keyword)));
      })
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }, [allChannels, dmSearchQuery, usersById]);

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

    return searchUsers(allUsers, dmSearchQuery, 10).filter(
      u => u.id !== currentUserId && !usersWithExistingDm.has(u.id),
    );
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
    userResults,
    totalResultCount,
    showDmSearchDropdown,
    setShowDmSearchDropdown,
    selectedDmSearchIndex,
    dmSearchInputRef,
    handleDmSearchKeyDown,
  };
};
