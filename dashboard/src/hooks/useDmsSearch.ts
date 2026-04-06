import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAllChannels } from './useChannels';
import { useUsers } from './useUsers';
import {
  isDMChannel,
  parseDMParticipantIds,
} from '../components/Chat/ChatDirectory/ChatDirectory.utils';
import { Channel } from '@xyne/shared';

interface UseDmsSearchReturn {
  dmSearchQuery: string;
  setDmSearchQuery: (query: string) => void;
  dmSearchResults: Channel[];
  showDmSearchDropdown: boolean;
  setShowDmSearchDropdown: (show: boolean) => void;
  selectedDmSearchIndex: number;
  dmSearchInputRef: React.RefObject<HTMLInputElement | null>;
  handleDmSearchKeyDown: (
    e: React.KeyboardEvent<HTMLInputElement>,
    onSelect: (channelId: string) => void,
  ) => void;
}

export const useDmsSearch = (): UseDmsSearchReturn => {
  const [dmSearchQuery, setDmSearchQuery] = useState('');
  const [showDmSearchDropdown, setShowDmSearchDropdown] = useState(false);
  const [selectedDmSearchIndex, setSelectedDmSearchIndex] = useState(0);
  const dmSearchInputRef = useRef<HTMLInputElement>(null);

  const allChannels = useAllChannels();
  const allUsers = useUsers();

  // Build a Map for O(1) user lookup (same as cmd+k approach in ChannelCommandMenu)
  const usersById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);

  const dmSearchResults = useMemo(() => {
    if (!dmSearchQuery.trim()) return [];

    // Support comma-separated keywords (same as cmd+k via useSearchMetrics)
    const keywords = dmSearchQuery
      .toLowerCase()
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);

    const dmChannels = allChannels.filter(channel => isDMChannel(channel.scopeType));

    return dmChannels.filter(dm => {
      const participantIds = parseDMParticipantIds(dm);
      const participantNames = participantIds
        .map(id => usersById.get(id)?.name?.toLowerCase())
        .filter((name): name is string => !!name);

      return keywords.some(keyword => participantNames.some(name => name.includes(keyword)));
    });
  }, [allChannels, dmSearchQuery, usersById]);

  // Reset selected index when search results change
  useEffect(() => {
    setSelectedDmSearchIndex(0);
  }, [dmSearchResults.length]);

  const handleDmSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, onSelect: (channelId: string) => void) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedDmSearchIndex(prev => (prev < dmSearchResults.length - 1 ? prev + 1 : prev));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedDmSearchIndex(prev => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === 'Enter' && dmSearchResults.length > 0) {
        e.preventDefault();
        const selectedChannel = dmSearchResults[selectedDmSearchIndex];
        if (selectedChannel) {
          onSelect(selectedChannel.id);
        }
      } else if (e.key === 'Escape') {
        setShowDmSearchDropdown(false);
        dmSearchInputRef.current?.blur();
      }
    },
    [dmSearchResults, selectedDmSearchIndex],
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
    dmSearchResults,
    showDmSearchDropdown,
    setShowDmSearchDropdown,
    selectedDmSearchIndex,
    dmSearchInputRef,
    handleDmSearchKeyDown,
  };
};
