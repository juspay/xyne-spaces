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
  Search,
  X,
  Check,
} from 'lucide-react';
import { useQuery as useReactQuery } from '@tanstack/react-query';
import * as Tabs from '@radix-ui/react-tabs';
//import * as Switch from '@radix-ui/react-switch';
import { Channel } from '@xyne/shared';
import {
  isDMChannel,
  isGroupDMChannel,
  isOneToOneDMChannel,
  getDMParticipantIdsToFetch,
  parseDMParticipantIds,
} from './ChatDirectory.utils';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import Avatar from '../../ui/Avatar/Avatar';
import Badge from '../../ui/Badge';
import { DisplaySearchResult } from '../../../types/search';
import {
  TabType,
  MentionType,
  ChannelCommandMenuProps,
  TYPE_SUGGESTIONS,
  SearchableTypes,
} from './ChannelCommandMenu.types';
import ThreadContextPanel from '../ThreadContextPanel/ThreadContextPanel';
import {
  buildContextItemFromResult,
  buildContextItemFromChannel,
} from '../ThreadContextPanel/contextItem.utils';
import { ChannelCategory } from './ChatDirectory.types';
import { navigateToSearchResult } from '../../../utils/searchNavigation';
import { useAllChannels } from '../../../hooks/useChannels';
import { useUsers } from '../../../hooks/useUsers';
import { cn } from '../../../utils/classNames';
import SearchResultItem from './SearchResultItem';
import { getUserDisplayName } from '../../../utils/userDisplayName';
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
import { usePlatform } from '../../../hooks/usePlatform';
import {
  summarizeSearchMessages,
  SearchMessageForSummary,
} from '../../../services/summarizeService';
import { SearchSummaryModal, SummaryModalState } from './SearchSummaryModal';
import { FilePreviewModal } from '../../FileViewer/FileViewerModal';
import { TYPE_AUTOCOMPLETE_REGEX, parseTypeFilter } from '../../../utils/searchFilterParser';

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

function stripHtmlTags(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || html;
}
const ChannelCommandItem = ({
  channel,
  currentUserID,
  unreadCount,
  search,
  onSelect,
  getChannelIcon,
  isSelected = false,
}: {
  channel: Channel;
  currentUserID: string;
  unreadCount: number;
  search: string;
  onSelect: (displayName: string) => void;
  getChannelIcon: (channel: Channel) => ReactElement;
  isSelected?: boolean;
}): ReactElement | null => {
  const { displayName } = useChannelDisplayName(channel, currentUserID);
  const { isMobile } = usePlatform();

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
      onSelect={() => onSelect(displayName)}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer mt-1 ${!isMobile && 'aria-selected:bg-gray-100'}`}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <div className='flex items-center justify-center h-4 w-5 flex-shrink-0'>
        {getChannelIcon(channel)}
      </div>
      <span className='flex-1 min-w-0 text-left text-xs font-medium text-foreground truncate'>
        {displayName}
      </span>
      {isSelected ? (
        <span className='flex-shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white'>
          <Check size={10} />
        </span>
      ) : (
        unreadCount > 0 && (
          <Badge variant='success' className='font-mono shrink-0 text-[10px] px-1.5 py-0'>
            {unreadCount}
          </Badge>
        )
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
  contextSelectionMode = false,
  contextItems = [],
  onContextItemToggle,
  onContextSelectionConfirm,
}: ChannelCommandMenuProps): ReactElement => {
  const navigate = useNavigate();
  const channelData = useAllChannels();
  const commandRef = useRef<HTMLDivElement>(null);

  useScope('command', open);

  useShortcutById(
    'global.search',
    () => {
      onOpenChange(!open);
      if (!open && !searchSessionId) {
        onOpen('keyboard_shortcut');
      }
    },
    { enabled: !contextSelectionMode },
  );

  useShortcutById(
    'command.close',
    () => {
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

      return participantNames;
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
    // setUseVespaSearch,
    loadMoreRef,
    filteredLocalUsers,
    filteredLocalChannels,
    typeFilter,
    searchText: cleanedSearchText,
    // Clipboard tracking callbacks
    onPasteDetected,
    onManualKeystroke,
  } = useSearchMetrics({
    allChannels,
    onSearchComplete: useCallback((results: DisplaySearchResult[], query: string) => {
      triggerSummaryFetchRef.current?.(results, query);
    }, []),
  });

  // Aliases to match old usage if needed or just use new names
  const search = cleanedSearchText;
  const setSearch = setSearchText;

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Type filter visibility - match tab behavior
  // type:users/people shows grouped local users (same as USERS tab)
  // type:channels shows grouped local channels (same as CHANNELS tab)
  const types = parseTypeFilter(typeFilter);
  const isUsersType = types.some(t => t === SearchableTypes.USERS || t === SearchableTypes.PEOPLE);
  const isChannelsType = types.includes(SearchableTypes.CHANNELS);
  const showGroupedLocalResults = !typeFilter || isChannelsType;
  const showGroupedUsers = !typeFilter || isUsersType;

  // Mention search
  const [mentionSearchQuery, setMentionSearchQuery] = useState('');
  const [mentionSearchType, setMentionSearchType] = useState<MentionType | null>(null);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

  const insertMentionRef = useRef<
    ((item: { id: string; name: string; email?: string }) => void) | null
  >(null);

  const insertTextRef = useRef<((text: string) => void) | null>(null);

  const { results: mentionSearchResults, searchMentions } = useMentionSearch();

  // Type autocomplete - derived from searchText
  const typeAutocomplete = useMemo(() => {
    const match = searchText.match(TYPE_AUTOCOMPLETE_REGEX);
    if (!match || match[1] === undefined) {
      return { suffix: '', suggestion: null, match: null };
    }
    const query = match[1].split(',').pop() || '';
    if (query.length === 0) {
      return { suffix: '', suggestion: null, match: null };
    }
    const suggestion = TYPE_SUGGESTIONS.find(
      t =>
        t.name.toLowerCase().startsWith(query.toLowerCase()) &&
        t.name.toLowerCase() !== query.toLowerCase(),
    );
    return {
      suffix: suggestion ? suggestion.name.slice(query.length) : '',
      suggestion,
      match,
    };
  }, [searchText]);
  const autocompleteSuffix = typeAutocomplete.suffix;

  const acceptTypeAutocomplete = useCallback(() => {
    if (!typeAutocomplete.suggestion || !typeAutocomplete.match) return;
    if (insertTextRef.current && typeAutocomplete.suffix) {
      insertTextRef.current(typeAutocomplete.suffix);
    }
    const beforeType = searchText.slice(0, typeAutocomplete.match.index) || '';
    const newText = beforeType + 'type:' + typeAutocomplete.suggestion.name;
    setSearch(newText);
  }, [typeAutocomplete, searchText, setSearch]);

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

  // File preview modal state
  const [previewFile, setPreviewFile] = useState<{
    fileName: string;
    fileUrl: string;
    mimeType: string;
    fileSize: number;
  } | null>(null);

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

  // Suppress hover highlights when dialog first opens to prevent dual-highlight
  // (CSS :hover on one item + aria-selected on another) when mouse is already resting in the dialog area
  const [suppressHover, setSuppressHover] = useState(false);

  // Platform detection - needs to be before useEffects that depend on it
  const { isMobile } = usePlatform();

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

  // Suppress hover on open to prevent dual-highlight when mouse is already in dialog area
  useEffect(() => {
    if (open) {
      setSuppressHover(true);
    }
  }, [open]);

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
    (text: string, mentions: Array<{ id: string; type: MentionType; prefix?: string }>) => {
      const trimmedText = text.trim();
      const prevTrimmedText = prevSearchTextRef.current.trim();

      // Start a new session when text is cleared (had content, now empty)
      // BUT don't trigger if mentions are present (indicates filter operator usage like from:/in:)
      if (prevTrimmedText && !trimmedText && mentions.length === 0) {
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
  // Channels: space maps to hyphen (e.g., "new test" matches "new-test")
  // Group DMs: comma or space splits into separate participant name queries
  const availableChannels = useMemo(() => {
    if (mentionSearchType !== MentionType.CHANNEL) return [];
    const searchLower = mentionSearchQuery.toLowerCase().trim();

    const matchesQuery = ({
      channel,
      searchableNames,
    }: {
      channel: Channel;
      searchableNames?: string[];
    }): boolean => {
      if (!searchLower) return true;

      if (isDMChannel(channel.scopeType) && searchableNames) {
        // Group DMs: split on commas, each part must match a participant
        const queryParts = searchLower
          .split(',')
          .map(p => p.trim())
          .filter(Boolean);
        const namesLower = searchableNames.map(n => n.toLowerCase());
        return queryParts.every(part => namesLower.some(name => name.includes(part)));
      }

      // Regular channels: match against channel name
      return channel.name.toLowerCase().includes(searchLower);
    };

    return allChannels.filter(matchesQuery).map(({ channel }) => {
      if (!isDMChannel(channel.scopeType)) return { channel, displayName: channel.name };
      const otherNames = getDMParticipantIdsToFetch(channel, currentUserID)
        .map(id => usersById.get(id)?.name)
        .filter((n): n is string => !!n);
      return { channel, displayName: otherNames.length > 0 ? otherNames.join(', ') : 'Group Chat' };
    });
  }, [allChannels, mentionSearchQuery, mentionSearchType, usersById, currentUserID]);

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

  // Reset expanded categories only when search text is cleared completely
  useEffect(() => {
    if (!searchText.trim()) {
      setExpandedCategories(new Set());
    }
  }, [searchText]);

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

  const handleChannelSelect = (
    channel: Channel,
    displayName: string,
    rankPosition?: number,
  ): void => {
    if (contextSelectionMode && onContextItemToggle) {
      onContextItemToggle(buildContextItemFromChannel(channel, displayName));
      return;
    }

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
    if (contextSelectionMode && onContextItemToggle) {
      onContextItemToggle(buildContextItemFromResult(result));
      return;
    }

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

  const handleFilePreview = useCallback((result: DisplaySearchResult): void => {
    if (result.type !== 'attachment' || !result.searchContext?.internalUrl) {
      return;
    }

    setPreviewFile({
      fileName: result.title,
      fileUrl: result.searchContext.internalUrl,
      mimeType: result.searchContext.mimeType || 'application/octet-stream',
      fileSize: result.searchContext.fileSize || 0,
    });
  }, []);

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

  const iconSize = isMobile ? 14 : 12;

  const tabs: Array<{ id: TabType; label: string; icon?: ReactElement }> = [
    // { id: TabType.ALL, label: 'All' },
    { id: TabType.USERS, label: 'People', icon: <Users size={iconSize} /> },
    { id: TabType.MESSAGES, label: 'Messages', icon: <MessageSquare size={iconSize} /> },
    { id: TabType.CHANNELS, label: 'Channels', icon: <Hash size={iconSize} /> },
    { id: TabType.TICKETS, label: 'Tickets', icon: <SquareDashedKanban size={iconSize} /> },
    { id: TabType.ATTACHMENTS, label: 'Files', icon: <FolderOpen size={iconSize} /> },
    // { id: TabType.NOTES, label: 'Notes', icon: <Paperclip size={1} /> },
  ];

  const getCategoryLabel = (category: ChannelCategory): string => {
    switch (category) {
      case ChannelCategory.STARRED:
        return 'Starred';
      case ChannelCategory.CHANNELS:
        return 'Channels';
      case ChannelCategory.DIRECT_MESSAGES:
        return 'Direct Messages';
      case ChannelCategory.GROUP_DMS:
        return 'Group DMs';
      default:
        return '';
    }
  };

  const getGroupLabel = (type: string): string => {
    switch (type) {
      case 'user':
        return 'Users';
      case 'channel':
        return 'Channels';
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
      onMouseMove={() => {
        if (suppressHover) {
          // Clear all manually-set aria-selected so cmdk's internal state takes over
          commandRef.current
            ?.querySelectorAll('[cmdk-item][aria-selected="true"]')
            .forEach(item => {
              item.setAttribute('aria-selected', 'false');
            });
          setSuppressHover(false);
        }
      }}
      className={cn(
        'fixed left-0 md:left-1/2 top-0 md:top-[14vh] -translate-x-0 md:-translate-x-1/2 md:translate-y-0 w-full',
        isMobile ? 'h-[100dvh] flex flex-col' : 'h-screen',
        contextSelectionMode ? 'md:max-w-4xl' : 'md:max-w-3xl',
        'md:w-full md:h-auto bg-white md:rounded-2xl shadow-[0px_7px_15px_0px_#0000000D,0px_28px_28px_0px_#00000017,0px_62px_37px_0px_#0000000D,0px_111px_44px_0px_#00000003,0px_173px_48px_0px_#00000000] border border-gray-200 z-50',
      )}
      onKeyDownCapture={e => {
        // ── Tab / Shift+Tab: cycle filter tabs ──────────────────────────────
        // If type autocomplete suggestion is showing, Tab accepts it instead of cycling tabs
        if (e.key === 'Tab' && !(typeAutocomplete.suggestion && typeAutocomplete.match)) {
          e.preventDefault();
          e.stopPropagation();

          if (activeTab === TabType.ALL) {
            // From ALL: Tab → first tab, Shift+Tab → last tab
            setActiveTab(e.shiftKey ? tabs[tabs.length - 1]!.id : tabs[0]!.id);
            return;
          }

          const idx = tabs.findIndex(t => t.id === activeTab);
          if (idx === -1) return; // Not found, shouldn't happen

          const next = e.shiftKey ? idx - 1 : idx + 1;

          if (next < 0 || next >= tabs.length) {
            setActiveTab(TabType.ALL);
          } else {
            setActiveTab(tabs[next]!.id);
          }
          return;
        }

        // ── Arrow key handling ───────────────────────────────────────────────
        // cmdk expects a Command.Input with cmdk-input attribute for focus management.
        // Since we use LexicalSearchInput (ContentEditable), cmdk's native arrow key
        // navigation doesn't work. We manually manage aria-selected for navigation.
        // See: https://github.com/pacocoursey/cmdk/issues/322
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const items = commandRef.current?.querySelectorAll(
            '[cmdk-item]:not([aria-disabled="true"])',
          );
          if (!items || items.length === 0) return;

          // Find current selection (-1 if nothing selected yet)
          const currentIndex = Array.from(items).findIndex(
            item => item.getAttribute('aria-selected') === 'true',
          );

          // Calculate next index
          let nextIndex: number;
          if (e.key === 'ArrowDown') {
            nextIndex =
              currentIndex < 0 ? 0 : currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
          } else {
            nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
          }

          // Update aria-selected on all items
          items.forEach((item, i) => {
            item.setAttribute('aria-selected', i === nextIndex ? 'true' : 'false');
          });

          // Scroll into view if needed
          items[nextIndex]?.scrollIntoView({ block: 'nearest' });

          // Suppress mouse hover highlights while navigating with keyboard.
          // Cleared on next mouse move (see onMouseMove handler above).
          setSuppressHover(true);

          e.preventDefault();
          return;
        }

        // ── Tab / Right Arrow: Accept type autocomplete suggestion ───────────
        if (
          (e.key === 'Tab' || e.key === 'ArrowRight') &&
          typeAutocomplete.suggestion &&
          typeAutocomplete.match
        ) {
          e.preventDefault();
          e.stopPropagation();
          acceptTypeAutocomplete();
          return;
        }

        // ── Enter handling ───────────────────────────────────────────────────
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
              name: getUserDisplayName(user),
              type: MentionType.USER,
              ...(user.email ? { email: user.email } : {}),
            });
          } else if (
            mentionSearchType === MentionType.CHANNEL &&
            availableChannels[selectedMentionIndex]
          ) {
            const { channel, displayName } = availableChannels[selectedMentionIndex];
            handleMentionSelect({
              id: channel.id,
              name: displayName,
              type: MentionType.CHANNEL,
            });
          }
          return;
        }

        // If type autocomplete is showing, accept it on Enter
        if (typeAutocomplete.suggestion && typeAutocomplete.match) {
          e.preventDefault();
          e.stopPropagation();
          acceptTypeAutocomplete();
          // Don't return - let the normal Enter flow continue to select the active item
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
      <div className='flex items-center border-b border-border'>
        {selectedBot && (
          <div className='flex items-center gap-2 pl-4 pr-2 py-2 bg-blue-50 border-r border-border'>
            <Bot size={14} className='text-blue-600' />
            <span className='text-sm font-medium text-blue-700'>{selectedBot.name}</span>
          </div>
        )}
        <div className='relative flex-1 flex items-center gap-2 px-4 py-[10px]'>
          <button
            onClick={() => onOpenChange(false)}
            className='p-1 rounded-md text-foreground hover:text-muted-foreground hover:bg-accent transition-colors duration-200 sm:hidden'
            aria-label='Go back'
            data-track-category='CHANNEL_SEARCH'
            data-track-name='CLOSE_SEARCH_MENU`'
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
              value={searchText}
              placeholder={`Search ${activeTab === TabType.ALL ? 'everything' : activeTab}...`}
              onChange={handleEditorChange}
              onUserSearch={handleUserSearch}
              onChannelSearch={handleChannelSearch}
              availableUsers={availableUsers}
              availableChannels={availableChannels.map(({ channel, displayName }) => ({
                id: channel.id,
                name: displayName,
              }))}
              className='flex-1'
              open={open}
              mentionSearchType={mentionSearchType}
              selectedMentionIndex={selectedMentionIndex}
              setSelectedMentionIndex={setSelectedMentionIndex}
              onInsertMentionReady={handleInsertMentionReady}
              onPasteDetected={onPasteDetected}
              onManualKeystroke={onManualKeystroke}
              autocompleteSuffix={autocompleteSuffix}
              onInsertTextReady={insertText => {
                insertTextRef.current = insertText;
              }}
            />
          )}
          {/* Search/Close Icon */}
          {isMobile && (
            <button
              onClick={() => {
                if (search.trim() || searchText.trim()) {
                  setSearch('');
                  setSearchText('');
                  setSelectedMentions([]);
                  if (inputRef.current) {
                    inputRef.current.blur();
                  }
                }
              }}
              className='p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0 flex items-center justify-center'
              aria-label={search.trim() || searchText.trim() ? 'Clear search' : 'Search'}
              data-track-category='CHANNEL_SEARCH'
              data-track-name={search.trim() || searchText.trim() ? 'ClearSearch' : 'OpenSearch'}
              data-track-metadata={JSON.stringify({ searchQuery: searchText })}
            >
              {search.trim() || searchText.trim() ? (
                <X className='w-4 h-4' />
              ) : (
                <Search className='w-4 h-4' />
              )}
            </button>
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
                data-track-category='CHANNEL_SEARCH'
                data-track-name='SUMMARIZE_SEARCH_RESULTS'
                data-track-metadata={JSON.stringify({ searchQuery: searchText })}
              >
                <Sparkles className='w-4 h-4' />
              </button>
            )}
          <kbd className='px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground border border-border rounded flex-shrink-0 hidden sm:block'>
            Esc
          </kbd>
        </div>
        {selectedBot && search.trim() && (
          <button
            onClick={() => void handleBotQuery()}
            disabled={botChatState.status === 'loading'}
            className='px-3 py-2 mr-2 text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50'
            data-track-category='CHANNEL_SEARCH'
            data-track-name='SEND_BOT_QUERY'
            data-track-metadata={JSON.stringify({
              botId: selectedBot?.id,
              botName: selectedBot?.name,
            })}
          >
            {botChatState.status === 'loading' ? (
              <Loader2 size={16} className='animate-spin' />
            ) : (
              <Send size={16} />
            )}
          </button>
        )}
      </div>

      {/* Body: results panel + optional context panel side-by-side */}
      <div className='flex flex-1 min-h-0 overflow-hidden'>
        {/* Tabs, Results, Footer Container - modal overlays everything below search input */}
        <div
          className='relative flex-1 flex flex-col min-h-0'
          role='presentation'
          data-track-category='CHANNEL_SEARCH'
          data-track-name='ClickSearchResultsArea'
          data-track-metadata={JSON.stringify({ hasResults })}
          onClick={() => {
            // Blur input when clicking anywhere in this container
            if (inputRef.current) {
              inputRef.current.blur();
            }
          }}
          onKeyDown={e => {
            // Blur input when pressing Enter or Space in this container
            if ((e.key === 'Enter' || e.key === ' ') && inputRef.current) {
              inputRef.current.blur();
            }
          }}
        >
          {/* Tabs - hidden when bot is selected */}
          {!selectedBot && !showBotsSuggestions && (
            <div className={`overflow-x-auto no-scrollbar p-2 ${isMobile ? 'mx-1' : 'ml-4'}`}>
              <Tabs.Root value={activeTab}>
                <Tabs.List className='flex items-center justify-start gap-[6px]'>
                  {tabs.map(tab => (
                    <Tabs.Trigger asChild key={tab.id} value={tab.id}>
                      <button
                        onClick={e => {
                          if (activeTab === tab.id) {
                            setActiveTab(TabType.ALL);
                          } else {
                            setActiveTab(tab.id);
                          }
                          // Blur input when clicking tabs
                          if (inputRef.current) {
                            inputRef.current.blur();
                          }
                          e.currentTarget.scrollIntoView({
                            behavior: 'smooth',
                            block: 'nearest',
                            inline: 'center',
                          });
                        }}
                        className={cn(
                          'flex items-center justify-center gap-1.5 px-2 text-[13px] py-[2px] max-h-6 whitespace-nowrap transition-colors cursor-pointer rounded-[10px] border',
                          activeTab === tab.id
                            ? 'border-[#6276BE] text-[#FFF] bg-[#6276BE]'
                            : 'border-[#E4E6E7] text-[#000] hover:text-gray-900',
                          isMobile && 'text-[14px] w-fit h-[37px] px-3',
                        )}
                        data-track-category='CHANNEL_SEARCH'
                        data-track-name='SELECT_SEARCH_TAB'
                        data-track-metadata={JSON.stringify({ tab: tab.id })}
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
            className={cn(
              'flex-1 overflow-y-auto md:max-h-[550px] p-2 ml-2',
              suppressHover && '[&_[cmdk-item]]:pointer-events-none',
            )}
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
                        {botChatState.status === 'success' &&
                          botChatState.toolOutputs.length > 0 && (
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
                                      toolOutput.singleStat
                                        ? ''
                                        : 'border border-gray-200 rounded-lg'
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
                    data-track-category='CHANNEL_SEARCH'
                    data-track-name='CONTINUE_BOT_IN_DM'
                    data-track-metadata={JSON.stringify({ botId: selectedBot?.id })}
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
                      className={`flex items-center gap-3 px-3 py-2 rounded-sm cursor-pointer ${!isMobile && 'aria-selected:bg-gray-100'}`}
                      style={{ WebkitTapHighlightColor: 'transparent' }}
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
                                name: getUserDisplayName(user),
                                type: MentionType.USER,
                                ...(user.email ? { email: user.email } : {}),
                              });
                            }}
                            onMouseEnter={() => {
                              if (setSelectedMentionIndex) {
                                setSelectedMentionIndex(index);
                              }
                            }}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-all duration-150 mt-1 ${
                              index === selectedMentionIndex ? 'bg-gray-100' : ''
                            } ${!isMobile && 'active:bg-gray-200 active:scale-[0.98]'}`}
                            style={{ WebkitTapHighlightColor: 'transparent' }}
                          >
                            <Avatar userId={user.id} size='sm' />
                            <div className='flex-1 min-w-0'>
                              <div className='font-semibold text-xs text-gray-800 truncate'>
                                {getUserDisplayName(user)}
                              </div>
                              {user.email && (
                                <div className='text-[11px] text-gray-500 truncate'>
                                  {user.email}
                                </div>
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
                        {availableChannels.map(({ channel, displayName }, index) => {
                          const isGroupDM = isGroupDMChannel(channel.scopeType);
                          return (
                            <Command.Item
                              key={channel.id}
                              value={`mention-channel-${channel.id}`}
                              onSelect={() => {
                                handleMentionSelect({
                                  id: channel.id,
                                  name: displayName,
                                  type: MentionType.CHANNEL,
                                });
                              }}
                              onMouseEnter={() => {
                                if (setSelectedMentionIndex) {
                                  setSelectedMentionIndex(index);
                                }
                              }}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-all duration-150 mt-1 ${
                                index === selectedMentionIndex ? 'bg-gray-100' : ''
                              } ${!isMobile && 'active:bg-gray-200 active:scale-[0.98]'}`}
                              style={{ WebkitTapHighlightColor: 'transparent' }}
                            >
                              <div className='flex items-center justify-center h-4 w-5 flex-shrink-0'>
                                {isGroupDM ? (
                                  <Users size={16} className='text-gray-600' />
                                ) : (
                                  <Hash size={16} className='text-gray-600' />
                                )}
                              </div>
                              <div className='flex-1 min-w-0'>
                                <div className='font-semibold text-xs text-gray-800 truncate'>
                                  {displayName}
                                </div>
                              </div>
                            </Command.Item>
                          );
                        })}
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
                    {/* When searching, ordered results: Starred, Users, Group DMs, Channels, Messages, Tickets */}
                    {searchText.trim() || typeFilter ? (
                      <>
                        {/* 0. Starred (from local channels) - shown very first */}
                        {(activeTab === TabType.ALL || activeTab === TabType.CHANNELS) &&
                          showGroupedLocalResults &&
                          groupedChannels['starred'] &&
                          groupedChannels['starred'].length > 0 && (
                            <div className='mb-4'>
                              {(() => {
                                const items = groupedChannels['starred'];
                                const category = ChannelCategory.STARRED;
                                const isExpanded = expandedCategories.has(category);
                                const hasMore = items.length > DISPLAY_LIMIT;
                                const displayItems =
                                  !isExpanded && hasMore ? items.slice(0, DISPLAY_LIMIT) : items;
                                const hiddenCount = items.length - DISPLAY_LIMIT;

                                return (
                                  <Command.Group
                                    heading={getCategoryLabel(category)}
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
                                          onSelect={displayName =>
                                            handleChannelSelect(channel, displayName, index + 1)
                                          }
                                          getChannelIcon={getChannelIcon}
                                          isSelected={contextItems.some(
                                            c => c.id === `channel-${channel.id}`,
                                          )}
                                        />
                                      );
                                    })}
                                    {hasMore && (
                                      <button
                                        onClick={() => toggleCategoryExpansion(category)}
                                        className={`w-full px-2 py-1.5 mt-1 text-xs text-gray-600 rounded-sm text-left transition-colors ${!isMobile && 'hover:text-gray-900 hover:bg-gray-50'}`}
                                        data-track-category='CHANNEL_SEARCH'
                                        data-track-name='TOGGLE_CHANNEL_CATEGORY_EXPANSION'
                                        data-track-metadata={JSON.stringify({
                                          category: category as string,
                                          isExpanded,
                                        })}
                                      >
                                        {isExpanded ? 'See less' : `See ${hiddenCount} more`}
                                      </button>
                                    )}
                                  </Command.Group>
                                );
                              })()}
                            </div>
                          )}

                        {/* 1. Users (from local) - shown first when searching, real-time updates */}
                        {(activeTab === TabType.ALL || activeTab === TabType.USERS) &&
                          showGroupedUsers &&
                          filteredLocalUsers.length > 0 && (
                            <div className='mb-4'>
                              {(() => {
                                // Map of DM User IDs for fast lookup (to prioritize active DMs)
                                const dmUserIdSet = new Set<string>();
                                groupedChannels['direct-messages']?.forEach(({ channel }) => {
                                  if (isOneToOneDMChannel(channel.scopeType)) {
                                    const participants = parseDMParticipantIds(channel);
                                    const otherUserId = participants.find(
                                      id => id !== currentUserID,
                                    );
                                    if (otherUserId) dmUserIdSet.add(otherUserId);
                                  }
                                });

                                // Convert local users to DisplaySearchResult format
                                const userItems: DisplaySearchResult[] = filteredLocalUsers.map(
                                  user => ({
                                    id: user.id,
                                    type: 'user' as const,
                                    title: user.name,
                                    subtitle: user.email || '',
                                    relevanceScore: 1,
                                    metadata: {},
                                  }),
                                );

                                // Prioritize users with active DMs
                                const usersWithDM = userItems.filter(item =>
                                  dmUserIdSet.has(item.id),
                                );
                                const usersNoDM = userItems.filter(
                                  item => !dmUserIdSet.has(item.id),
                                );
                                const allItems = [...usersWithDM, ...usersNoDM];

                                const totalItemsCount = allItems.length;
                                const displayCount = totalItemsCount;

                                const isExpanded = expandedCategories.has('user');
                                const hasMore = totalItemsCount > DISPLAY_LIMIT;

                                const displayItems =
                                  !isExpanded && hasMore
                                    ? allItems.slice(0, DISPLAY_LIMIT)
                                    : allItems;

                                const hiddenCount = totalItemsCount - DISPLAY_LIMIT;

                                return (
                                  <Command.Group
                                    heading={`${getGroupLabel('user')} (${displayCount})`}
                                    className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[#788187] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-["Geist_Mono"]'
                                  >
                                    {displayItems.map((item, index) => (
                                      <SearchResultItem
                                        key={item.id}
                                        result={item}
                                        onSelect={res => handleBackendResultSelect(res, index + 1)}
                                        isSelected={contextItems.some(
                                          c => c.id === `${item.type}-${item.id}`,
                                        )}
                                      />
                                    ))}
                                    {hasMore && (
                                      <button
                                        onClick={() => toggleCategoryExpansion('user')}
                                        className={`w-full px-2 py-1.5 mt-1 text-xs text-gray-600 rounded-sm text-left transition-colors ${!isMobile && 'hover:text-gray-900 hover:bg-gray-50'}`}
                                        style={{
                                          WebkitTapHighlightColor: 'transparent',
                                          userSelect: 'none',
                                        }}
                                        data-track-category='CHANNEL_SEARCH'
                                        data-track-name='TOGGLE_CATEGORY_EXPANSION'
                                        data-track-metadata={JSON.stringify({
                                          category: 'user',
                                          isExpanded,
                                        })}
                                      >
                                        {isExpanded ? 'See less' : `See ${hiddenCount} more`}
                                      </button>
                                    )}
                                  </Command.Group>
                                );
                              })()}
                            </div>
                          )}

                        {/* 2. Group DMs (from local channels) - only show group DMs in search results, 1:1 DMs are in Users section */}
                        {(() => {
                          const groupDMs =
                            groupedChannels['direct-messages']?.filter(({ channel }) =>
                              isGroupDMChannel(channel.scopeType),
                            ) || [];
                          return (
                            (activeTab === TabType.ALL || activeTab === TabType.CHANNELS) &&
                            showGroupedLocalResults &&
                            groupDMs.length > 0 && (
                              <div className='mb-4'>
                                <Command.Group
                                  heading={getCategoryLabel(ChannelCategory.GROUP_DMS)}
                                  className='[&_[cmdk-group-heading]]:px-2  [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[#788187] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-["Geist_Mono"]'
                                >
                                  {groupDMs.map(({ channel }, index) => {
                                    const unreadCount = unreadCounts[channel.id] ?? 0;
                                    return (
                                      <ChannelCommandItem
                                        key={channel.id}
                                        channel={channel}
                                        currentUserID={currentUserID}
                                        unreadCount={unreadCount}
                                        search={search}
                                        onSelect={displayName =>
                                          handleChannelSelect(channel, displayName, index + 1)
                                        }
                                        getChannelIcon={getChannelIcon}
                                        isSelected={contextItems.some(
                                          c => c.id === `channel-${channel.id}`,
                                        )}
                                      />
                                    );
                                  })}
                                </Command.Group>
                              </div>
                            )
                          );
                        })()}

                        {/* 3. Channels (from local channels) */}
                        {(activeTab === TabType.ALL || activeTab === TabType.CHANNELS) &&
                          showGroupedLocalResults &&
                          groupedChannels['channels'] &&
                          groupedChannels['channels'].length > 0 && (
                            <div className='mb-4'>
                              {(() => {
                                const items = groupedChannels['channels'];
                                const category = ChannelCategory.CHANNELS;
                                const isExpanded = expandedCategories.has(category);
                                const hasMore = items.length > DISPLAY_LIMIT;
                                const displayItems =
                                  !isExpanded && hasMore ? items.slice(0, DISPLAY_LIMIT) : items;
                                const hiddenCount = items.length - DISPLAY_LIMIT;

                                return (
                                  <Command.Group
                                    heading={getCategoryLabel(category)}
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
                                          onSelect={displayName =>
                                            handleChannelSelect(channel, displayName, index + 1)
                                          }
                                          getChannelIcon={getChannelIcon}
                                          isSelected={contextItems.some(
                                            c => c.id === `channel-${channel.id}`,
                                          )}
                                        />
                                      );
                                    })}
                                    {hasMore && (
                                      <button
                                        onClick={() => toggleCategoryExpansion(category)}
                                        className={`w-full px-2 py-1.5 mt-1 text-xs text-muted-foreground rounded-sm text-left transition-colors ${!isMobile && 'hover:text-foreground hover:bg-accent'}`}
                                        style={{
                                          WebkitTapHighlightColor: 'transparent',
                                          userSelect: 'none',
                                        }}
                                        data-track-category='CHANNEL_SEARCH'
                                        data-track-name='TOGGLE_GROUP_DM_CATEGORY_EXPANSION'
                                        data-track-metadata={JSON.stringify({
                                          category: category as string,
                                          isExpanded,
                                        })}
                                      >
                                        {isExpanded ? 'See less' : `See ${hiddenCount} more`}
                                      </button>
                                    )}
                                  </Command.Group>
                                );
                              })()}
                            </div>
                          )}

                        {/* 4. Backend Results (Messages, Tickets, Attachments) */}
                        {backendResults.length > 0 && (
                          <>
                            {['conversation', 'ticket', 'attachment']
                              .filter(type => {
                                if (activeTab === TabType.ALL) return true;
                                if (activeTab === TabType.MESSAGES && type === 'conversation')
                                  return true;
                                if (activeTab === TabType.TICKETS && type === 'ticket') return true;
                                if (activeTab === TabType.ATTACHMENTS && type === 'attachment')
                                  return true;
                                return false;
                              })
                              .map(type => {
                                const items = groupedBackendResults[type];
                                if (!items || items.length === 0) return null;

                                const displayCount =
                                  useVespaSearch && activeTab !== TabType.ALL
                                    ? paginationState[activeTab].cumulativeCount
                                    : items.length;

                                return (
                                  <div key={type} className='mb-4'>
                                    <Command.Group
                                      heading={`${getGroupLabel(type)} (${displayCount})`}
                                      className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[#788187] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-["Geist_Mono"]'
                                    >
                                      {items.map((result, index) => (
                                        <SearchResultItem
                                          key={result.id}
                                          result={result}
                                          onSelect={res =>
                                            handleBackendResultSelect(res, index + 1)
                                          }
                                          onPreview={handleFilePreview}
                                          isSelected={contextItems.some(
                                            c => c.id === `${result.type}-${result.id}`,
                                          )}
                                        />
                                      ))}
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
                    ) : (
                      <>
                        {/* Local Channels Results - shown when no search/filter OR when type:channels */}
                        {(activeTab === TabType.ALL ||
                          activeTab === TabType.CHANNELS ||
                          isChannelsType) &&
                          filteredLocalChannels.length > 0 && (
                            <>
                              {Object.entries(groupedChannels).map(([category, items]) => {
                                const typedCategory = category as ChannelCategory;
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
                                      heading={getCategoryLabel(typedCategory)}
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
                                            onSelect={displayName =>
                                              handleChannelSelect(channel, displayName, index + 1)
                                            }
                                            getChannelIcon={getChannelIcon}
                                            isSelected={contextItems.some(
                                              c => c.id === `channel-${channel.id}`,
                                            )}
                                          />
                                        );
                                      })}
                                      {shouldLimit && hasMore && (
                                        <button
                                          onClick={() => toggleCategoryExpansion(category)}
                                          className={`w-full px-2 py-1.5 mt-1 text-xs text-gray-600 rounded-sm text-left transition-colors ${!isMobile && 'hover:text-gray-900 hover:bg-gray-50'}`}
                                          style={{
                                            WebkitTapHighlightColor: 'transparent',
                                            userSelect: 'none',
                                          }}
                                          data-track-category='CHANNEL_SEARCH'
                                          data-track-name='TOGGLE_LOCAL_CHANNEL_EXPANSION'
                                          data-track-metadata={JSON.stringify({
                                            category: category,
                                            isExpanded,
                                          })}
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
                                          onSelect={res =>
                                            handleBackendResultSelect(res, index + 1)
                                          }
                                          onPreview={handleFilePreview}
                                          isSelected={contextItems.some(
                                            c => c.id === `${result.type}-${result.id}`,
                                          )}
                                        />
                                      ))}
                                      {isUserType && hasMore && (
                                        <button
                                          onClick={() => toggleCategoryExpansion(type)}
                                          className={`w-full px-2 py-1.5 mt-1 text-xs text-gray-600 rounded-sm text-left transition-colors ${!isMobile && 'hover:text-gray-900 hover:bg-gray-50'}`}
                                          style={{
                                            WebkitTapHighlightColor: 'transparent',
                                            userSelect: 'none',
                                          }}
                                          data-track-category='CHANNEL_SEARCH'
                                          data-track-name='TOGGLE_BACKEND_USER_EXPANSION'
                                          data-track-metadata={JSON.stringify({ type, isExpanded })}
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
              </>
            )}
          </Command.List>

          {/* Footer */}
          {!isMobile && (
            <div className='px-4 py-2 border-t border-gray-200 text-xs text-gray-500 flex items-center justify-end shrink-0 bg-[#FAFAFA] rounded-b-2xl'>
              {/* Vespa Search toggle - commented out, using Vespa as default
          <div className='flex items-center gap-2'>
            <label htmlFor='vespa-toggle' className='text-xs text-muted-foreground cursor-pointer'>
              Vespa Search
            </label>
            <Switch.Root
              id='vespa-toggle'
              checked={useVespaSearch}
              onCheckedChange={setUseVespaSearch}
              className='w-9 h-5 bg-muted-foreground/40 rounded-full relative data-[state=checked]:bg-blue-500 transition-colors'
            >
              <Switch.Thumb className='block w-4 h-4 bg-background rounded-full transition-transform duration-100 translate-x-0.5 will-change-transform data-[state=checked]:translate-x-[18px]' />
            </Switch.Root>
          </div>
          */}
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
          )}

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

        {/* Context Panel - shown on right side in context selection mode */}
        {contextSelectionMode && (
          <ThreadContextPanel
            items={contextItems}
            onRemove={id => {
              const item = contextItems.find(c => c.id === id);
              if (item && onContextItemToggle) onContextItemToggle(item);
            }}
            onConfirm={() => onContextSelectionConfirm?.()}
          />
        )}
      </div>
      {/* end body flex row */}

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          isOpen={!!previewFile}
          onClose={() => setPreviewFile(null)}
          fileName={stripHtmlTags(previewFile.fileName)}
          fileUrl={previewFile.fileUrl}
          mimeType={previewFile.mimeType}
          fileSize={previewFile.fileSize}
        />
      )}
    </Command.Dialog>
  );
};

export default ChannelCommandMenu;
