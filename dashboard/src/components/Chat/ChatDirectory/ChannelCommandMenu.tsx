import React, { ReactElement, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import {
  Hash,
  Loader2,
  MessageSquare,
  Users,
  FolderOpen,
  SquareDashedKanban,
  ArrowLeft,
  Bot,
  ArrowRight,
  Send,
  Sparkles,
  CornerDownLeft,
  MoveUp,
  MoveDown,
} from 'lucide-react';
import { useQuery as useReactQuery } from '@tanstack/react-query';
import * as Tabs from '@radix-ui/react-tabs';
import * as Switch from '@radix-ui/react-switch';
import { Channel } from '@xyne/shared';
import {
  isDMChannel,
  getDMParticipantIdsToFetch,
  parseDMParticipantIds,
} from './ChatDirectory.utils';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import Avatar from '../../ui/Avatar/Avatar';
import Badge from '../../ui/Badge';
import { DisplaySearchResult } from '../../../types/search';
import { TabType, MentionType, ChannelCommandMenuProps } from './ChannelCommandMenu.types';
import { ChannelCategory } from './ChatDirectory.types';
import { navigateToSearchResult } from '../../../utils/searchNavigation';
import { useAllChannels } from '../../../hooks/useChannels';
import { useUsers } from '../../../hooks/useUsers';
import { cn } from '../../../utils/classNames';
import SearchResultItem from './SearchResultItem';
import {
  mixpanelService,
  EVENTS,
  EVENT_PROPERTIES,
} from '../../../services/Analytics/mixpanelService';
import { LexicalSearchInput } from './LexicalSearchInput';
import { useMentionSearch } from '../../../hooks/useMentionSearch';
import { botService, UnifiedBotInfo, ToolOutput } from '../../../services/Bot/botService';
import { channelService } from '../../../services/Chat/channelService';
import { ToolOutputRenderer } from 'cosmic-ai-genius';
import { useSearchMetrics } from '../../../hooks/useSearchMetrics';
import { useScope, useShortcutById } from '../../../shortcuts';
import {
  summarizeSearchMessages,
  SearchMessageForSummary,
} from '../../../services/summarizeService';
import { SearchSummaryModal, SummaryModalState } from './SearchSummaryModal';

type BotChatState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'success';
      response: string;
      channelId: string | null;
      conversationId: string | null;
      toolOutputs: ToolOutput[];
    }
  | { status: 'error'; message: string };

const ChannelCommandItem = ({
  channel,
  currentUserID,
  unreadCount,
  search,
  onSelect,
  getChannelIcon,
}: {
  channel: Channel;
  currentUserID: string;
  unreadCount: number;
  search: string;
  onSelect: () => void;
  getChannelIcon: (channel: Channel) => ReactElement;
}): ReactElement | null => {
  const { displayName } = useChannelDisplayName(channel, currentUserID);

  if (
    search.trim() &&
    !displayName.toLowerCase().includes(search.toLowerCase()) &&
    !isDMChannel(channel.scopeType)
  ) {
    return null;
  }

  return (
    <Command.Item
      key={channel.id}
      value={`channel-${channel.id}-${displayName}`}
      onSelect={onSelect}
      className='flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-gray-100 aria-selected:bg-gray-100 mt-1'
    >
      <div className='flex items-center justify-center h-4 w-5 flex-shrink-0'>
        {getChannelIcon(channel)}
      </div>
      <span className='flex-1 min-w-0 text-left text-xs font-medium text-gray-800 truncate'>
        {displayName}
      </span>
      {unreadCount > 0 && (
        <Badge variant='success' className='font-mono shrink-0 text-[10px] px-1.5 py-0'>
          {unreadCount}
        </Badge>
      )}
    </Command.Item>
  );
};

const ChannelCommandMenu = ({
  channels,
  starred,
  directMessages,
  currentUserID,
  unreadCounts,
  open,
  onOpenChange,
}: ChannelCommandMenuProps): ReactElement => {
  const navigate = useNavigate();
  const channelData = useAllChannels();
  const commandRef = useRef<HTMLDivElement>(null);

  useScope('command', open);

  useShortcutById('global.search', () => {
    onOpenChange(!open);
    if (!open && !searchSessionId) {
      onOpen('keyboard_shortcut');
    }
  });

  useShortcutById(
    'command.close',
    () => {
      console.log('i am called');
      onOpenChange(false);
    },
    {
      enabled: open,
    },
  );

  const allUsers = useUsers();
  // Map users by ID for quick lookup
  const usersById = useMemo(() => {
    return new Map(allUsers.map(user => [user.id, user]));
  }, [allUsers]);

  // Move 'allChannels' definition up here to pass to hook
  const allChannels = useMemo(() => {
    const result: Array<{
      channel: Channel;
      category: ChannelCategory;
      searchableNames?: string[];
    }> = [];

    const getSearchableNames = (channel: Channel): string[] => {
      if (!isDMChannel(channel.scopeType)) {
        return [channel.name];
      }

      const userIds = parseDMParticipantIds(channel);

      const participantNames = userIds
        .map(userId => usersById.get(userId)?.name)
        .filter((name): name is string => !!name);

      const concatenated = participantNames.join(',');
      return [concatenated];
    };

    // Add starred channels
    starred.forEach(channel => {
      result.push({
        channel,
        category: ChannelCategory.STARRED,
        searchableNames: getSearchableNames(channel),
      });
    });

    // Add regular channels
    channels.forEach(channel => {
      result.push({
        channel,
        category: ChannelCategory.CHANNELS,
        searchableNames: [channel.name],
      });
    });

    // Add direct messages
    directMessages.forEach(channel => {
      result.push({
        channel,
        category: ChannelCategory.DIRECT_MESSAGES,
        searchableNames: getSearchableNames(channel),
      });
    });

    return result;
  }, [channels, starred, directMessages, usersById]);

  const {
    searchResults: backendResults,
    isSearching: isLoading,
    searchError: error,
    paginationState,
    isLoadingMore,
    resetSearchState,
    onOpen,
    onClose,
    onResultClick,
    setScrollContainer,
    searchSessionId,
    text: searchText,
    setText: setSearchText,
    inputRef,
    // New hookstate
    activeTab,
    setActiveTab,

    setSelectedMentions,
    useVespaSearch,
    setUseVespaSearch,
    loadMoreRef,
    filteredLocalUsers,
    filteredLocalChannels,
  } = useSearchMetrics({ allChannels });

  // Aliases to match old usage if needed or just use new names
  const search = searchText;
  const setSearch = setSearchText; // Alias strictness might be issue but setText takes string | fn

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Mention search
  const [mentionSearchQuery, setMentionSearchQuery] = useState('');
  const [mentionSearchType, setMentionSearchType] = useState<MentionType | null>(null);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

  const insertMentionRef = useRef<
    ((item: { id: string; name: string; email?: string }) => void) | null
  >(null);
  const { results: mentionSearchResults, searchMentions } = useMentionSearch();

  // Summary modal state
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryState, setSummaryState] = useState<SummaryModalState>('loading');
  const [summaryRawContent, setSummaryRawContent] = useState('');
  const [summaryData, setSummaryData] = useState<{ summary: string; keypoints: string[] }>({
    summary: '',
    keypoints: [],
  });
  const [summaryError, setSummaryError] = useState<string | undefined>();
  const summaryAbortControllerRef = useRef<AbortController | null>(null);
  const summaryRequestIdRef = useRef(0);
  // Track the last search query that triggered a summary fetch
  const lastSummaryQueryRef = useRef('');

  const DISPLAY_LIMIT = 5;

  // Fetch available bots - only show DM-capable bots in command menu
  const { data: availableBots = [] } = useReactQuery({
    queryKey: ['bots', 'dm-capable'],
    queryFn: async () => {
      const bots = await botService.listAllBots();
      return bots.filter(bot => bot.interactionMode === 'dm');
    },
    staleTime: 10 * 60 * 1000, // 10 minutes - bots don't change often
  });

  const [selectedBot, setSelectedBot] = useState<UnifiedBotInfo | null>(null);
  const [botChatState, setBotChatState] = useState<BotChatState>({ status: 'idle' });

  const resetBotMode = useCallback((): void => {
    setSelectedBot(null);
    setBotChatState({ status: 'idle' });
  }, []);

  // Trigger summary fetch in background (does NOT show modal)
  const triggerSummaryFetch = useCallback(
    (results: DisplaySearchResult[], query: string): void => {
      // Skip if already fetching for this query
      if (lastSummaryQueryRef.current === query && summaryState !== 'error') {
        return;
      }

      // Filter results to only conversation messages (exclude tickets)
      const messageResults = results.filter(result => result.type === 'conversation');

      if (messageResults.length === 0) {
        setSummaryState('no_messages');
        setSummaryError('No message results to summarize.');
        return;
      }

      // Mark this query as being fetched
      lastSummaryQueryRef.current = query;

      // Cancel any pending request
      if (summaryAbortControllerRef.current) {
        summaryAbortControllerRef.current.abort();
      }

      // Increment request ID for race condition handling
      const currentRequestId = ++summaryRequestIdRef.current;

      // Reset state
      setSummaryState('loading');
      setSummaryRawContent('');
      setSummaryData({ summary: '', keypoints: [] });
      setSummaryError(undefined);

      // Create abort controller
      const abortController = new AbortController();
      summaryAbortControllerRef.current = abortController;

      // Convert results to message format for API
      const messages: SearchMessageForSummary[] = messageResults.map(result => ({
        title: result.metadata?.channelName || 'Unknown Channel',
        subtitle: result.subtitle?.split(':')[0] || 'Unknown',
        context: result.context || result.subtitle || '',
        timestamp: result.metadata?.timestamp || new Date().toISOString(),
        messageId: result.searchContext?.messageId || result.id,
        conversationId: result.searchContext?.conversationId || '',
        senderId: result.searchContext?.senderId,
      }));

      // Start streaming in background
      void summarizeSearchMessages(
        query,
        messages,
        {
          onStart: () => {
            if (summaryRequestIdRef.current !== currentRequestId) return;
            setSummaryState('streaming');
          },
          onDelta: content => {
            if (summaryRequestIdRef.current !== currentRequestId) return;
            setSummaryRawContent(prev => prev + content);
          },
          onComplete: data => {
            if (summaryRequestIdRef.current !== currentRequestId) return;
            setSummaryData({ summary: data.summary, keypoints: data.keypoints });
            setSummaryState('complete');
          },
          onError: error => {
            if (summaryRequestIdRef.current !== currentRequestId) return;
            setSummaryError(error);
            setSummaryState('error');
          },
          onNoMessages: message => {
            if (summaryRequestIdRef.current !== currentRequestId) return;
            setSummaryError(message);
            setSummaryState('no_messages');
          },
        },
        abortController.signal,
      );
    },
    [summaryState],
  );

  // Handle summarize button click - just shows modal (summary may already be loading/loaded)
  const handleSummarize = useCallback((): void => {
    // If no summary is being fetched, trigger it now
    if (
      summaryState === 'loading' &&
      summaryRawContent === '' &&
      lastSummaryQueryRef.current !== searchText.trim()
    ) {
      const messageResults = backendResults.filter(result => result.type === 'conversation');
      if (messageResults.length > 0) {
        triggerSummaryFetch(backendResults, searchText.trim());
      } else {
        setSummaryState('no_messages');
      }
    }
    // Show the modal
    setShowSummaryModal(true);
  }, [backendResults, searchText, summaryState, summaryRawContent, triggerSummaryFetch]);

  // Close summary modal
  const handleCloseSummary = useCallback((): void => {
    setShowSummaryModal(false);
    // Abort any pending request
    if (summaryAbortControllerRef.current) {
      summaryAbortControllerRef.current.abort();
      summaryAbortControllerRef.current = null;
    }
  }, []);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      resetBotMode();
    }
  }, [open, resetBotMode]);

  // Handle bot query submission
  const handleBotQuery = useCallback(async (): Promise<void> => {
    if (!selectedBot || !search.trim() || botChatState.status === 'loading') return;

    setBotChatState({ status: 'loading' });

    try {
      const result = await botService.chatWithBot(selectedBot.id, search.trim());
      setBotChatState({
        status: 'success',
        response: result.content,
        channelId: result.channelId ?? null,
        conversationId: result.conversationId ?? null,
        toolOutputs: result.toolOutputs ?? [],
      });
    } catch (err) {
      setBotChatState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to get response',
      });
    }
  }, [selectedBot, search, botChatState.status]);

  // Handle "Continue in DM" navigation
  const handleContinueInDM = useCallback(async (): Promise<void> => {
    if (!selectedBot) return;

    try {
      // If we already have the channel and conversation ID from the chat, navigate to that thread
      if (
        botChatState.status === 'success' &&
        botChatState.channelId &&
        botChatState.conversationId
      ) {
        void navigate(`/chat/dm/${botChatState.channelId}/${botChatState.conversationId}`);
        onOpenChange(false);
        return;
      }

      // If we only have channel ID, navigate to the channel
      if (botChatState.status === 'success' && botChatState.channelId) {
        void navigate(`/chat/dm/${botChatState.channelId}`);
        onOpenChange(false);
        return;
      }

      // Otherwise, create a DM channel using the bot's dbUserId
      if (!selectedBot.dbUserId) {
        setBotChatState({ status: 'error', message: 'Bot user ID not available' });
        return;
      }
      const response = await channelService.createDm({ participantIds: [selectedBot.dbUserId] });
      void navigate(`/chat/dm/${response.id}`);
      onOpenChange(false);
    } catch {
      setBotChatState({ status: 'error', message: 'Failed to open DM channel' });
    }
  }, [selectedBot, botChatState, navigate, onOpenChange]);

  // Handle bot selection from dropdown
  const handleBotSelect = useCallback((bot: UnifiedBotInfo): void => {
    setSelectedBot(bot);
    setSearch(''); // Clear search - bot is shown as blue box
    setBotChatState({ status: 'idle' });
  }, []);

  // Handle input keydown for bot mode
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter' && selectedBot && search.trim() && botChatState.status !== 'loading') {
        e.preventDefault();
        void handleBotQuery();
      } else if (e.key === 'Backspace' && selectedBot && search === '') {
        // Exit bot mode when backspacing on empty input
        e.preventDefault();
        resetBotMode();
      }
    },
    [selectedBot, search, botChatState.status, handleBotQuery, resetBotMode],
  );

  // Filter bots based on search (when typing @)
  const filteredBots = useMemo(() => {
    if (!search.startsWith('@')) return [];
    const searchTerm = search.slice(1).toLowerCase().split(' ')[0] ?? '';
    if (!searchTerm) return availableBots;
    return availableBots.filter(
      bot =>
        bot.name?.toLowerCase().includes(searchTerm) || bot.id?.toLowerCase().includes(searchTerm),
    );
  }, [search, availableBots]);

  // Show bots section when typing @ but no bot selected yet
  const showBotsSuggestions = search.startsWith('@') && !selectedBot;

  // Track previous search text to detect when cleared
  const prevSearchTextRef = useRef('');

  // Handle Lexical editor change - extract text and mentions
  const handleEditorChange = useCallback(
    (text: string, mentions: Array<{ id: string; type: MentionType }>) => {
      const trimmedText = text.trim();
      const prevTrimmedText = prevSearchTextRef.current.trim();

      // Start a new session when text is cleared (had content, now empty)
      if (prevTrimmedText && !trimmedText) {
        onClose('clear');
        onOpen('keyboard_shortcut');
      }

      setSearch(text);
      setSearchText(text); // This will be used for search, mentions filtered separately
      setSelectedMentions(mentions);

      // Update ref for next comparison
      prevSearchTextRef.current = text;
    },
    [onClose, onOpen],
  );

  // Handle mention selection from search results
  const handleMentionSelect = useCallback(
    (mention: { id: string; name: string; type: MentionType; email?: string }) => {
      if (insertMentionRef.current) {
        insertMentionRef.current({
          id: mention.id,
          name: mention.name,
          ...(mention.email ? { email: mention.email } : {}),
        });

        // Clear mention search state after a delay to allow insertion to complete
        setTimeout(() => {
          setMentionSearchType(null);
          setMentionSearchQuery('');
          setSelectedMentionIndex(0);
        }, 100);
      }
    },
    [],
  );

  // Store the insertMention function when it's ready
  const handleInsertMentionReady = useCallback(
    (insertMention: (item: { id: string; name: string; email?: string }) => void) => {
      insertMentionRef.current = insertMention;
    },
    [],
  );

  // Handle user search from mention plugin
  const handleUserSearch = useCallback(
    (query: string | null) => {
      if (query === null) {
        // Mention search was cancelled/cleared
        setMentionSearchType(null);
        setMentionSearchQuery('');
        setSelectedMentionIndex(0);
        return;
      }
      setMentionSearchQuery(query);
      setMentionSearchType(MentionType.USER);
      setSelectedMentionIndex(0); // Reset selection when search changes
      searchMentions(query);
    },
    [searchMentions],
  );

  // Handle channel search from mention plugin
  const handleChannelSearch = useCallback((query: string | null) => {
    if (query === null) {
      // Mention search was cancelled/cleared
      setMentionSearchType(null);
      setMentionSearchQuery('');
      setSelectedMentionIndex(0);
      return;
    }
    setMentionSearchQuery(query);
    setMentionSearchType(MentionType.CHANNEL);
    setSelectedMentionIndex(0); // Reset selection when search changes
  }, []);

  // Filter mention results for users
  const availableUsers = useMemo(() => {
    if (mentionSearchType !== MentionType.USER) return [];
    return mentionSearchResults
      .filter(result => result.type === MentionType.USER)
      .map(result => ({
        id: result.id,
        name: result.name,
        ...(result.email && { email: result.email }),
      }));
  }, [mentionSearchResults, mentionSearchType]);

  // Filter mention results for channels
  const availableChannels = useMemo(() => {
    if (mentionSearchType !== MentionType.CHANNEL) return [];
    const searchLower = mentionSearchQuery.toLowerCase();
    return allChannels
      .filter(({ channel }) => {
        if (searchLower && !channel.name.toLowerCase().includes(searchLower)) {
          return false;
        }
        return true;
      })
      .map(({ channel }) => channel);
  }, [allChannels, mentionSearchQuery, mentionSearchType]);

  // Use a ref for triggerSummaryFetch to avoid dependency cycles and infinite loops
  const triggerSummaryFetchRef = useRef(triggerSummaryFetch);
  useEffect(() => {
    triggerSummaryFetchRef.current = triggerSummaryFetch;
  }, [triggerSummaryFetch]);

  // Track search performed in command menu (debounced)
  useEffect(() => {
    if (!searchText.trim() && activeTab !== TabType.CHANNELS) return;

    const timer = setTimeout((): void => {
      mixpanelService.track(EVENTS.SEARCH_PERFORMED, {
        searchType: EVENT_PROPERTIES.SEARCH_TYPES.COMMAND_MENU,
        searchCategory: activeTab,
        resultsCount: filteredLocalChannels.length,
      });
    }, 500); // 500ms debounce

    return (): void => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, activeTab]);

  // Reset state when menu closes
  useEffect(() => {
    if (!open) {
      setSearch('');
      setSearchText('');
      setSelectedMentions([]);
      setMentionSearchQuery('');
      setMentionSearchType(null);
      setActiveTab(TabType.ALL);
      resetSearchState();
      setExpandedCategories(new Set());

      // Reset the previous search text refs
      prevSearchTextRef.current = '';

      if (searchSessionId) {
        onClose();
      }
    }
  }, [open, searchSessionId, onClose, resetSearchState]);

  const toggleCategoryExpansion = (category: string): void => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  const handleChannelSelect = (channel: Channel, rankPosition?: number): void => {
    const route = `/chat/dir/${channel.id}`;

    // Track click on channel if metrics available
    onResultClick(
      { id: channel.id, type: 'channel' } as DisplaySearchResult,
      rankPosition ?? 1,
      channel.id,
      route,
    );

    void navigate(route);
    onOpenChange(false);
  };

  const handleBackendResultSelect = async (
    result: DisplaySearchResult,
    rankPosition: number,
  ): Promise<void> => {
    // Track click on search result
    if (searchText.trim()) {
      onResultClick(result, rankPosition, result.searchContext?.channelId);
    }

    try {
      await navigateToSearchResult(result, navigate, channelData || []);
      onOpenChange(false);
    } catch (err) {
      console.error('Navigation failed:', err);
    }
  };

  const getChannelIcon = (channel: Channel): ReactElement => {
    if (isDMChannel(channel.scopeType)) {
      const userIds = getDMParticipantIdsToFetch(channel, currentUserID);
      if (userIds.length > 0 && userIds[0]) {
        return <Avatar userId={userIds[0]} size='sm' />;
      }
    }
    return <Hash size={14} />;
  };

  // Group results by type for display
  const groupedBackendResults = useMemo(() => {
    const groups: Record<string, DisplaySearchResult[]> = {};
    backendResults.forEach(result => {
      if (!groups[result.type]) {
        groups[result.type] = [];
      }
      groups[result.type]!.push(result);
    });
    return groups;
  }, [backendResults]);

  // Group local channels by category
  const groupedChannels = useMemo(() => {
    const groups: Record<string, typeof filteredLocalChannels> = {};
    filteredLocalChannels.forEach(item => {
      if (!groups[item.category]) {
        groups[item.category] = [];
      }
      groups[item.category]!.push(item);
    });
    return groups;
  }, [filteredLocalChannels]);

  const tabs: Array<{ id: TabType; label: string; icon?: ReactElement }> = [
    // { id: TabType.ALL, label: 'All' },
    { id: TabType.USERS, label: 'People', icon: <Users size={12} /> },
    { id: TabType.MESSAGES, label: 'Messages', icon: <MessageSquare size={12} /> },
    { id: TabType.CHANNELS, label: 'Channels', icon: <Hash size={12} /> },
    { id: TabType.TICKETS, label: 'Tickets', icon: <SquareDashedKanban size={12} /> },
    { id: TabType.ATTACHMENTS, label: 'Files', icon: <FolderOpen size={12} /> },
    // { id: TabType.NOTES, label: 'Notes', icon: <Paperclip size={14} /> },
  ];

  const getCategoryLabel = (category: ChannelCategory): string => {
    switch (category) {
      case ChannelCategory.STARRED:
        return 'Starred';
      case ChannelCategory.CHANNELS:
        return 'Channels';
      case ChannelCategory.DIRECT_MESSAGES:
        return 'Direct Messages';
      default:
        return '';
    }
  };

  const getGroupLabel = (type: string): string => {
    switch (type) {
      case 'user':
        return 'Users';
      case 'conversation':
        return 'Messages';
      case 'ticket':
        return 'Tickets';
      case 'attachment':
        return 'Attachments';
      default:
        return '';
    }
  };

  const hasResults =
    ((activeTab === TabType.ALL || activeTab === TabType.CHANNELS) &&
      filteredLocalChannels.length > 0) ||
    ((activeTab === TabType.ALL || activeTab === TabType.USERS) && filteredLocalUsers.length > 0) ||
    (activeTab !== TabType.CHANNELS && activeTab !== TabType.USERS && backendResults.length > 0);

  const showEmptyState = searchText.trim() && !isLoading && !hasResults;

  return (
    <Command.Dialog
      open={open}
      ref={commandRef}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      className='fixed left-0 md:left-1/2 top-0 md:top-[14vh] -translate-x-0 md:-translate-x-1/2 md:translate-y-0 w-full h-screen md:w-full md:max-w-3xl md:h-auto bg-white md:rounded-2xl shadow-[0px_7px_15px_0px_#0000000D,0px_28px_28px_0px_#00000017,0px_62px_37px_0px_#0000000D,0px_111px_44px_0px_#00000003,0px_173px_48px_0px_#00000000]
 border border-gray-200 z-50'
      onKeyDownCapture={e => {
        if (e.key !== 'Enter') return;

        // Shift+Enter → allow newline in Lexical
        if (e.shiftKey) return;

        // If a bot is selected, let the input's onKeyDown handle it
        if (selectedBot) return;

        // If showing bot suggestions, let cmdk handle selection natively
        if (showBotsSuggestions) return;

        // If mention search is active, let the mention selection handle Enter
        if (mentionSearchType !== null) {
          // Select the currently highlighted mention
          e.preventDefault();
          e.stopPropagation();

          if (mentionSearchType === MentionType.USER && availableUsers[selectedMentionIndex]) {
            const user = availableUsers[selectedMentionIndex];
            handleMentionSelect({
              id: user.id,
              name: user.name,
              type: MentionType.USER,
              ...(user.email ? { email: user.email } : {}),
            });
          } else if (
            mentionSearchType === MentionType.CHANNEL &&
            availableChannels[selectedMentionIndex]
          ) {
            const channel = availableChannels[selectedMentionIndex];
            handleMentionSelect({
              id: channel.id,
              name: channel.name,
              type: MentionType.CHANNEL,
            });
          }
          return;
        }

        // Prevent Lexical newline
        e.preventDefault();
        e.stopPropagation();

        // Tell cmdk to select the active item
        const activeItem = commandRef.current?.querySelector(
          '[cmdk-item][aria-selected="true"]',
        ) as HTMLElement | null;

        activeItem?.click();
      }}
    >
      {/* Search Input with Bot Selection */}
      <div className='flex items-center border-b border-gray-200'>
        {selectedBot && (
          <div className='flex items-center gap-2 pl-4 pr-2 py-2 bg-blue-50 border-r border-gray-200'>
            <Bot size={14} className='text-blue-600' />
            <span className='text-sm font-medium text-blue-700'>{selectedBot.name}</span>
          </div>
        )}
        <div className='relative flex-1 flex items-center gap-2 px-4 py-[10px]'>
          <button
            onClick={() => onOpenChange(false)}
            className='p-1 rounded-md text-gray-900 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-200 sm:hidden'
            aria-label='Go back'
          >
            <ArrowLeft size={20} />
          </button>
          {selectedBot ? (
            <Command.Input
              ref={inputRef}
              placeholder={`Ask ${selectedBot.name}...`}
              value={search}
              onValueChange={setSearch}
              onKeyDown={handleInputKeyDown}
              className='flex-1 text-sm focus:outline-none'
            />
          ) : showBotsSuggestions ? (
            <Command.Input
              ref={inputRef}
              placeholder='Search bots...'
              value={search}
              onValueChange={setSearch}
              className='flex-1 text-sm focus:outline-none'
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          ) : (
            <LexicalSearchInput
              placeholder={`Search ${activeTab === TabType.ALL ? 'everything' : activeTab}...`}
              onChange={handleEditorChange}
              onUserSearch={handleUserSearch}
              onChannelSearch={handleChannelSearch}
              availableUsers={availableUsers}
              availableChannels={availableChannels}
              className='flex-1'
              open={open}
              mentionSearchType={mentionSearchType}
              selectedMentionIndex={selectedMentionIndex}
              setSelectedMentionIndex={setSelectedMentionIndex}
              onInsertMentionReady={handleInsertMentionReady}
            />
          )}
          {/* Summarize Button - icon only, left of Esc */}
          {searchText.trim() &&
            !isLoading &&
            backendResults.some(r => r.type === 'conversation') &&
            !(
              (summaryState === 'loading' || summaryState === 'streaming') &&
              summaryRawContent.length === 0
            ) && (
              <button
                onClick={handleSummarize}
                className='p-1.5 rounded-md text-purple-600 hover:text-purple-700 hover:bg-purple-50 transition-colors flex-shrink-0 hidden sm:flex items-center justify-center'
                aria-label='Summarize search results'
                title='Summarize search results'
              >
                <Sparkles className='w-4 h-4' />
              </button>
            )}
          <kbd className='px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 border border-[#E1E4EA] rounded flex-shrink-0 hidden sm:block'>
            Esc
          </kbd>
        </div>
        {selectedBot && search.trim() && (
          <button
            onClick={() => void handleBotQuery()}
            disabled={botChatState.status === 'loading'}
            className='px-3 py-2 mr-2 text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50'
          >
            {botChatState.status === 'loading' ? (
              <Loader2 size={16} className='animate-spin' />
            ) : (
              <Send size={16} />
            )}
          </button>
        )}
      </div>

      {/* Tabs, Results, Footer Container - modal overlays everything below search input */}
      <div className='relative flex-1 flex flex-col min-h-0'>
        {/* Tabs - hidden when bot is selected */}
        {!selectedBot && !showBotsSuggestions && (
          <div className='overflow-x-auto no-scrollbar p-2 ml-4'>
            <Tabs.Root value={activeTab}>
              <Tabs.List className='flex items-center justify-start gap-[6px]'>
                {tabs.map(tab => (
                  <Tabs.Trigger asChild key={tab.id} value={tab.id}>
                    <button
                      onClick={() =>
                        activeTab === tab.id ? setActiveTab(TabType.ALL) : setActiveTab(tab.id)
                      }
                      className={cn(
                        'flex items-center gap-1.5 px-2 text-[13px] py-[2px] max-h-6  whitespace-nowrap transition-colors cursor-pointer rounded-md border-[0.5px]',
                        activeTab === tab.id
                          ? 'border-gray-900 text-gray-900'
                          : 'border-gray-300 text-gray-600 hover:text-gray-900',
                      )}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </Tabs.Root>
          </div>
        )}

        {/* Results */}
        <Command.List
          className='flex-1 md:max-h-[550px] overflow-y-auto p-2 ml-2'
          ref={el => {
            if (el) {
              setScrollContainer(el);
            }
          }}
        >
          {/* Bot Chat Mode */}
          {selectedBot ? (
            <div className='p-4'>
              {/* Bot description */}
              <p className='text-xs text-gray-500 mb-4'>{selectedBot.description}</p>

              {/* Bot response area */}
              {(botChatState.status === 'success' || botChatState.status === 'loading') && (
                <div className='bg-gray-50 rounded-lg p-3 mb-4 border border-gray-200'>
                  <div className='flex items-start gap-2'>
                    <Bot size={16} className='text-blue-600 mt-0.5 flex-shrink-0' />
                    <div className='flex-1 min-w-0'>
                      {botChatState.status === 'success' && botChatState.response && (
                        <p className='text-sm whitespace-pre-wrap break-words'>
                          {botChatState.response}
                        </p>
                      )}
                      {botChatState.status === 'loading' && (
                        <span className='animate-pulse'>▊</span>
                      )}
                      {/* Render tool outputs */}
                      {botChatState.status === 'success' && botChatState.toolOutputs.length > 0 && (
                        <div className='mt-3 space-y-2 max-h-48 overflow-y-auto'>
                          {botChatState.toolOutputs.map(toolOutput => (
                            <div key={toolOutput.id} className='w-full overflow-hidden'>
                              {toolOutput.description && (
                                <div className='text-sm text-gray-600 mb-2'>
                                  {toolOutput.description}
                                </div>
                              )}
                              <ToolOutputRenderer
                                toolOutput={toolOutput}
                                className={
                                  toolOutput.singleStat ? '' : 'border border-gray-200 rounded-lg'
                                }
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Error message */}
              {botChatState.status === 'error' && (
                <div className='bg-red-50 text-red-600 rounded-lg p-3 mb-4 text-sm'>
                  {botChatState.message}
                </div>
              )}

              {/* Continue in DM button */}
              {botChatState.status === 'success' && (
                <button
                  onClick={() => void handleContinueInDM()}
                  className='flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 hover:underline'
                >
                  <span>Continue in DM</span>
                  <ArrowRight size={14} />
                </button>
              )}

              {/* Hint when no query entered yet */}
              {botChatState.status === 'idle' && !search.trim() && (
                <p className='text-sm text-gray-400 text-center py-4'>
                  Type your question and press Enter
                </p>
              )}
            </div>
          ) : showBotsSuggestions ? (
            /* Show bot suggestions when typing @ */
            <>
              <Command.Group
                heading='Bots'
                className='[&_[cmdk-group-heading]]:px-2  [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[#788187] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-["Geist_Mono"]'
              >
                {filteredBots.map(bot => (
                  <Command.Item
                    key={bot.id}
                    value={`@${bot.name}`}
                    onSelect={() => handleBotSelect(bot)}
                    className='flex items-center gap-3 px-3 py-2 rounded-sm cursor-pointer hover:bg-gray-100 aria-selected:bg-gray-100'
                  >
                    <div className='flex items-center justify-center h-8 w-8 rounded-full bg-blue-100 flex-shrink-0'>
                      <Bot size={16} className='text-blue-600' />
                    </div>
                    <div className='flex-1 min-w-0'>
                      <span className='text-sm font-medium text-gray-800 block'>{bot.name}</span>
                      <span className='text-xs text-gray-500 truncate block'>
                        {bot.description}
                      </span>
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
              {filteredBots.length === 0 && (
                <Command.Empty className='py-6 text-center text-sm text-gray-500'>
                  No bots found.
                </Command.Empty>
              )}
            </>
          ) : (
            /* Normal search mode */
            <>
              {/* Mention Suggestions - Show when mention search is active */}
              {mentionSearchType && (
                <>
                  {mentionSearchType === MentionType.USER && availableUsers.length > 0 && (
                    <Command.Group
                      heading='Users'
                      className='[&_[cmdk-group-heading]]:px-2  [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[#788187] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-["Geist_Mono"]'
                    >
                      {availableUsers.map((user, index) => (
                        <Command.Item
                          key={user.id}
                          value={`mention-user-${user.id}`}
                          onSelect={() => {
                            handleMentionSelect({
                              id: user.id,
                              name: user.name,
                              type: MentionType.USER,
                              ...(user.email ? { email: user.email } : {}),
                            });
                          }}
                          onMouseEnter={() => {
                            if (setSelectedMentionIndex) {
                              setSelectedMentionIndex(index);
                            }
                          }}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-all duration-150 hover:bg-gray-100 active:bg-gray-200 active:scale-[0.98] mt-1 ${
                            index === selectedMentionIndex ? 'bg-gray-100' : ''
                          }`}
                        >
                          <Avatar userId={user.id} size='sm' />
                          <div className='flex-1 min-w-0'>
                            <div className='font-semibold text-xs text-gray-800 truncate'>
                              {user.name}
                            </div>
                            {user.email && (
                              <div className='text-[11px] text-gray-500 truncate'>{user.email}</div>
                            )}
                          </div>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                  {mentionSearchType === MentionType.CHANNEL && availableChannels.length > 0 && (
                    <Command.Group
                      heading='Channels'
                      className='[&_[cmdk-group-heading]]:px-2  [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[#788187] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-["Geist_Mono"]'
                    >
                      {availableChannels.map((channel, index) => (
                        <Command.Item
                          key={channel.id}
                          value={`mention-channel-${channel.id}`}
                          onSelect={() => {
                            handleMentionSelect({
                              id: channel.id,
                              name: channel.name,
                              type: MentionType.CHANNEL,
                            });
                          }}
                          onMouseEnter={() => {
                            if (setSelectedMentionIndex) {
                              setSelectedMentionIndex(index);
                            }
                          }}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-all duration-150 hover:bg-gray-100 active:bg-gray-200 active:scale-[0.98] mt-1 ${
                            index === selectedMentionIndex ? 'bg-gray-100' : ''
                          }`}
                        >
                          <div className='flex items-center justify-center h-4 w-5 flex-shrink-0'>
                            <Hash size={16} className='text-gray-600' />
                          </div>
                          <div className='flex-1 min-w-0'>
                            <div className='font-semibold text-xs text-gray-800 truncate'>
                              {channel.name}
                            </div>
                          </div>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                  {mentionSearchType === MentionType.USER &&
                    availableUsers.length === 0 &&
                    mentionSearchQuery && (
                      <Command.Empty className='py-6 text-center text-xs text-gray-500'>
                        No users found for &quot;{mentionSearchQuery}&quot;
                      </Command.Empty>
                    )}
                  {mentionSearchType === MentionType.CHANNEL &&
                    availableChannels.length === 0 &&
                    mentionSearchQuery && (
                      <Command.Empty className='py-6 text-center text-xs text-gray-500'>
                        No channels found for &quot;{mentionSearchQuery}&quot;
                      </Command.Empty>
                    )}
                </>
              )}

              {showEmptyState && !mentionSearchType && (
                <Command.Empty className='py-6 text-center text-xs text-gray-500'>
                  No results found for &quot;{search}&quot;
                </Command.Empty>
              )}

              {error && <div className='p-3 text-xs text-red-600'>{error}</div>}

              {!showEmptyState && !error && !mentionSearchType && (
                <>
                  {/* Local Channels Results */}
                  {(activeTab === TabType.ALL || activeTab === TabType.CHANNELS) &&
                    filteredLocalChannels.length > 0 && (
                      <>
                        {Object.entries(groupedChannels).map(([category, items]) => {
                          const isExpanded = expandedCategories.has(category);
                          const shouldLimit = !search.trim();
                          const hasMore = items.length > DISPLAY_LIMIT;
                          const displayItems =
                            shouldLimit && !isExpanded && hasMore
                              ? items.slice(0, DISPLAY_LIMIT)
                              : items;
                          const hiddenCount = items.length - DISPLAY_LIMIT;

                          return (
                            <div key={category} className='mb-4'>
                              <Command.Group
                                heading={getCategoryLabel(category as ChannelCategory)}
                                className='[&_[cmdk-group-heading]]:px-2  [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[#788187] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-["Geist_Mono"]'
                              >
                                {displayItems.map(({ channel }, index) => {
                                  const unreadCount = unreadCounts[channel.id] ?? 0;
                                  return (
                                    <ChannelCommandItem
                                      key={channel.id}
                                      channel={channel}
                                      currentUserID={currentUserID}
                                      unreadCount={unreadCount}
                                      search={search}
                                      onSelect={() => handleChannelSelect(channel, index + 1)}
                                      getChannelIcon={getChannelIcon}
                                    />
                                  );
                                })}
                                {shouldLimit && hasMore && (
                                  <button
                                    onClick={() => toggleCategoryExpansion(category)}
                                    className='w-full px-2 py-1.5 mt-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-sm text-left transition-colors'
                                  >
                                    {isExpanded ? 'See less' : `See ${hiddenCount} more`}
                                  </button>
                                )}
                              </Command.Group>
                            </div>
                          );
                        })}
                      </>
                    )}

                  {/* Backend Search Results */}
                  {activeTab !== TabType.CHANNELS && backendResults.length > 0 && (
                    <>
                      {Object.entries(groupedBackendResults)
                        .sort(([typeA], [typeB]) => {
                          // Prioritize 'user' type to render first
                          if (typeA === 'user') return -1;
                          if (typeB === 'user') return 1;
                          return 0;
                        })
                        .map(([type, items]) => {
                          let displayCount: number;
                          if (activeTab === TabType.ALL) {
                            displayCount = items.length;
                          } else if (useVespaSearch) {
                            // For Vespa on individual tabs, use cumulative count
                            displayCount = paginationState[activeTab].cumulativeCount;
                          } else {
                            // For PG search, use items length
                            displayCount = items.length;
                          }
                          // Apply limiting only to users
                          const isUserType = type === 'user';
                          const isExpanded = expandedCategories.has(type);
                          const hasMore = items.length > DISPLAY_LIMIT;
                          const displayItems =
                            isUserType && !isExpanded && hasMore
                              ? items.slice(0, DISPLAY_LIMIT)
                              : items;
                          const hiddenCount = items.length - DISPLAY_LIMIT;

                          return (
                            <div key={type} className='mb-4'>
                              <Command.Group
                                heading={`${getGroupLabel(type)} (${displayCount})`}
                                className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[#788187] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-["Geist_Mono"]'
                              >
                                {displayItems.map((result, index) => (
                                  <SearchResultItem
                                    key={result.id}
                                    result={result}
                                    onSelect={res => handleBackendResultSelect(res, index + 1)}
                                  />
                                ))}
                                {isUserType && hasMore && (
                                  <button
                                    onClick={() => toggleCategoryExpansion(type)}
                                    className='w-full px-2 py-1.5 mt-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-sm text-left transition-colors'
                                  >
                                    {isExpanded ? 'See less' : `See ${hiddenCount} more`}
                                  </button>
                                )}
                              </Command.Group>
                            </div>
                          );
                        })}

                      {/* Infinite scroll trigger and loading indicator */}
                      {paginationState[activeTab].hasMore && (
                        <div ref={loadMoreRef} className='py-4 flex justify-center'>
                          {isLoadingMore && (
                            <div className='flex items-center gap-2 text-xs text-gray-500'>
                              <Loader2 className='h-4 w-4 animate-spin' />
                              <span>Loading more results...</span>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </Command.List>

        {/* Footer */}
        <div className='px-4 py-2 border-t border-gray-200 text-xs text-gray-500 flex items-center justify-between shrink-0 bg-[#FAFAFA] rounded-b-2xl'>
          <div className='flex items-center gap-2'>
            <label htmlFor='vespa-toggle' className='text-xs text-gray-600 cursor-pointer'>
              Vespa Search
            </label>
            <Switch.Root
              id='vespa-toggle'
              checked={useVespaSearch}
              onCheckedChange={setUseVespaSearch}
              className='w-9 h-5 bg-gray-300 rounded-full relative data-[state=checked]:bg-blue-500 transition-colors'
            >
              <Switch.Thumb className='block w-4 h-4 bg-white rounded-full transition-transform duration-100 translate-x-0.5 will-change-transform data-[state=checked]:translate-x-[18px]' />
            </Switch.Root>
          </div>
          <div className='flex items-center gap-6'>
            <span className='flex gap-[10px] items-center'>
              <span>Open</span>
              <span className='p-1 bg-white rounded-md border border-[#E4E6E7]'>
                <CornerDownLeft size={10} />
              </span>
            </span>
            {/* <span className='text-gray-300'>|</span> */}
            <span className='flex gap-[10px] items-center'>
              <span>Navigate </span>
              <span className='flex gap-1'>
                <span className='p-1 bg-white rounded-md border border-[#E4E6E7]'>
                  <MoveUp size={12} />
                </span>
                <span className='p-1 bg-white rounded-md border border-[#E4E6E7]'>
                  <MoveDown size={12} />
                </span>
              </span>
            </span>
          </div>
        </div>

        {/* Summary Modal Overlay - covers both results and footer */}
        <SearchSummaryModal
          isOpen={showSummaryModal}
          onClose={handleCloseSummary}
          state={summaryState}
          searchQuery={searchText}
          rawContent={summaryRawContent}
          summary={summaryData.summary}
          keypoints={summaryData.keypoints}
          error={summaryError}
        />
      </div>
    </Command.Dialog>
  );
};

export default ChannelCommandMenu;
