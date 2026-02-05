import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { searchMetricsService } from '../services/searchMetricsService';
import { useAuthContextValues } from './useAuth';
import { searchService } from '../services/searchService';
import { mixpanelService, EVENTS, EVENT_PROPERTIES } from '../services/Analytics/mixpanelService';
import {
  DisplaySearchResult,
  GlobalSearchFilters,
  SearchableEntityType,
  VespaSearchFilters,
} from '../types/search';
import {
  TabType,
  MentionType,
  VespaApps,
  VespaDocTypes,
} from '../components/Chat/ChatDirectory/ChannelCommandMenu.types';
import { User } from '../machines/stateMachine';
import { Channel } from '@xyne/shared';
import { useUserSearch } from './useUsers';
import { ChannelCategory } from '../components/Chat/ChatDirectory/ChatDirectory.types';
import { parseSearchFilters } from '../utils/searchFilterParser';

type SearchTrigger = 'keyboard_shortcut' | 'click' | 'auto_focus';
type SearchLocation = 'global' | 'channel' | 'dm';

interface UseSearchMetricsOptions {
  searchLocation?: SearchLocation;
  allChannels?: Array<{ channel: Channel; category: ChannelCategory; searchableNames?: string[] }>;
}

const BACKEND_RESULTS_LIMIT = 25;

export function useSearchMetrics(options: UseSearchMetricsOptions = {}) {
  const context = useAuthContextValues();
  const [searchSessionId, setSearchSessionId] = useState<string | null>(null);
  const searchTriggerRef = useRef<SearchTrigger | null>(null);
  const impressionStartTimeRef = useRef<number>(0);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const sessionStartTimeRef = useRef<number>(0);
  const lastImpressionTimeRef = useRef<number>(0);
  const impressionCountRef = useRef<number>(0);
  const lastQueryTextRef = useRef<string>('');
  const maxQueryLengthTextRef = useRef<string>('');
  const previousTabRef = useRef<TabType>(TabType.ALL);

  // Search Input State
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // New State moved from ChannelCommandMenu
  const [activeTab, setActiveTab] = useState<TabType>(TabType.ALL);
  const [selectedMentions, setSelectedMentions] = useState<
    Array<{ id: string; type: MentionType; prefix?: string }>
  >([]);
  const [useVespaSearch, setUseVespaSearch] = useState(true);

  // Load More Ref
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Filter local users using the search hook
  const filteredLocalUsers = useUserSearch(text, BACKEND_RESULTS_LIMIT);

  // Filter local channels
  const filteredLocalChannels: Array<{
    channel: Channel;
    category: ChannelCategory;
    searchableNames?: string[];
  }> = useMemo(() => {
    if (!options.allChannels || !text.trim()) return options.allChannels || [];

    const searchLower = text.toLowerCase();
    const keywords = searchLower.split(',').map(k => k.trim().toLowerCase());

    return options.allChannels.filter(({ channel, searchableNames }) => {
      if (searchableNames && searchableNames.length > 0) {
        const searchableKeywords = searchableNames[0]?.toLowerCase() || '';
        return keywords.some(keyword => keyword !== '' && searchableKeywords.includes(keyword));
      }
      return channel.name.toLowerCase().includes(searchLower);
    });
  }, [options.allChannels, text]);

  const [currentSearchContext, setCurrentSearchContext] = useState<{
    query: string;
    activeTab: TabType;
    localResultsCount: number;
    facetCounts: Record<string, number>;
  }>({
    query: '',
    activeTab: TabType.ALL,
    localResultsCount: 0,
    facetCounts: {},
  });

  const prevSearchTextLengthRef = useRef(0);

  // Search State
  const [searchResults, setSearchResults] = useState<DisplaySearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [paginationState, setPaginationState] = useState<
    Record<
      TabType,
      {
        page: number;
        hasMore: boolean;
        total: number;
        offset: number;
        cumulativeCount: number;
      }
    >
  >({
    [TabType.ALL]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
    [TabType.USERS]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
    [TabType.CHANNELS]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
    [TabType.MESSAGES]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
    [TabType.TICKETS]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
    [TabType.ATTACHMENTS]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
  });

  const pendingSearchCountRef = useRef(0);
  const latestResultsRef = useRef<DisplaySearchResult[]>([]);

  /**
   * Generate a unique session ID
   */
  const generateSearchSessionId = useCallback((): string => {
    return `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  /**
   * Start a new search session
   * Called when user opens search (Cmd+K) or types first character
   */
  const startSession = useCallback(
    (trigger: SearchTrigger) => {
      const newSessionId = generateSearchSessionId();
      setSearchSessionId(newSessionId);
      searchTriggerRef.current = trigger;
      sessionStartTimeRef.current = Date.now();
      impressionCountRef.current = 0;
      lastQueryTextRef.current = '';
      maxQueryLengthTextRef.current = '';

      searchMetricsService.trackSessionStart(
        newSessionId,
        String(context.userID),
        previousTabRef.current,
      );

      return newSessionId;
    },
    [generateSearchSessionId, context.userID],
  );

  /**
   * End the current search session
   * Called when user clears search input or closes search
   */
  const endSession = useCallback(
    (endReason: 'click' | 'abandon' | 'clear' | 'blur' = 'abandon') => {
      if (!searchSessionId) {
        setSearchSessionId(null);
        searchTriggerRef.current = null;
        impressionStartTimeRef.current = 0;
        return;
      }

      const now = Date.now();

      // Calculate dwell time (time since last impression)
      const dwellTimeMs =
        lastImpressionTimeRef.current > 0 ? now - lastImpressionTimeRef.current : 0;

      // Calculate total session duration
      const totalSessionDurationMs =
        sessionStartTimeRef.current > 0 ? now - sessionStartTimeRef.current : 0;

      // For 'clear' events, use max query length text; otherwise use last query text
      const queryTextForEnd =
        endReason === 'clear' ? maxQueryLengthTextRef.current : lastQueryTextRef.current;

      // Track session end event
      if (queryTextForEnd || endReason === 'click' || endReason === 'abandon') {
        searchMetricsService.trackSessionEnd({
          searchSessionId,
          userId: String(context.userID),
          queryText: queryTextForEnd || '',
          totalImpressions: impressionCountRef.current,
          dwellTimeMs,
          endReason,
          totalSessionDurationMs,
          tab: previousTabRef.current,
        });
      }

      // Reset state
      setSearchSessionId(null);
      searchTriggerRef.current = null;
      impressionStartTimeRef.current = 0;
      sessionStartTimeRef.current = 0;
      lastImpressionTimeRef.current = 0;
      impressionCountRef.current = 0;
      lastQueryTextRef.current = '';
      maxQueryLengthTextRef.current = '';
    },
    [searchSessionId, context.userID],
  );

  /**
   * Track search impression (results displayed)
   */
  const trackImpression = useCallback(
    (params: { queryText: string; totalHits: number; facetCounts: Record<string, number> }) => {
      if (!searchSessionId || !searchTriggerRef.current) {
        return;
      }

      const now = Date.now();
      const latencyMs =
        impressionStartTimeRef.current > 0 ? now - impressionStartTimeRef.current : 0;

      searchMetricsService.trackImpression({
        searchSessionId,
        userId: String(context.userID),
        queryText: params.queryText,
        totalHits: params.totalHits,
        latencyMs,
        facetCounts: params.facetCounts,
        searchTrigger: searchTriggerRef.current,
        ...(options.searchLocation && { searchLocation: options.searchLocation }),
        tab: previousTabRef.current,
      });

      // Update tracking state for dwell time calculation
      lastImpressionTimeRef.current = now;
      impressionCountRef.current += 1;
      lastQueryTextRef.current = params.queryText;

      // Track max query length for clear events
      if (params.queryText.length > maxQueryLengthTextRef.current.length) {
        maxQueryLengthTextRef.current = params.queryText;
      }

      // Reset for next search
      impressionStartTimeRef.current = 0;
    },
    [searchSessionId, context.userID, options.searchLocation],
  );

  /**
   * Mark the start of a search request (for latency tracking)
   */
  const markSearchStart = useCallback(() => {
    impressionStartTimeRef.current = Date.now();
  }, []);

  /**
   * Calculate scroll depth percentage
   */
  const calculateScrollDepth = useCallback((): number | undefined => {
    if (!scrollContainerRef.current) {
      return undefined;
    }

    const container = scrollContainerRef.current;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    if (scrollHeight <= clientHeight) {
      return 0; // No scroll needed
    }

    const scrollPercentage = (scrollTop / (scrollHeight - clientHeight)) * 100;
    return Math.round(scrollPercentage);
  }, []);

  /**
   * Track search result click
   */
  const trackClick = useCallback(
    (params: {
      queryText: string;
      clickedDocId: string;
      clickedDocType: string;
      rankPosition: number;
      channel?: string;
      resultUrl?: string;
    }) => {
      if (!searchSessionId) {
        return;
      }

      const scrollDepth = calculateScrollDepth();

      searchMetricsService.trackClick({
        searchSessionId,
        userId: String(context.userID),
        queryText: params.queryText,
        clickedDocId: params.clickedDocId,
        clickedDocType: params.clickedDocType,
        rankPosition: params.rankPosition,
        ...(params.channel && { channel: params.channel }),
        ...(scrollDepth !== undefined && { scrollDepth }),
        ...(params.resultUrl && { resultUrl: params.resultUrl }),
        tab: previousTabRef.current,
      });

      // End the session with 'click' reason after tracking the click
      endSession('click');
    },
    [searchSessionId, context.userID, calculateScrollDepth, endSession],
  );

  /**
   * Set the scroll container for scroll depth tracking
   */
  const setScrollContainer = useCallback((element: HTMLElement | null) => {
    scrollContainerRef.current = element;
  }, []);

  /**
   * Reset the previous search text refs
   */
  const resetImpressionTracking = useCallback(() => {
    prevSearchTextLengthRef.current = 0;
  }, []);

  /**
   * Internal wrapper for startSession
   */
  const onOpen = useCallback(
    (trigger: SearchTrigger) => {
      startSession(trigger);
    },
    [startSession],
  );

  /**
   * Internal wrapper for endSession
   */
  const onClose = useCallback(
    (reason?: 'click' | 'abandon' | 'clear' | 'blur') => {
      endSession(reason);
      resetImpressionTracking();
    },
    [endSession, resetImpressionTracking],
  );

  /**
   * Track Result Click
   */
  const onResultClick = useCallback(
    (result: DisplaySearchResult, rankPosition: number, channelId?: string, resultUrl?: string) => {
      if (currentSearchContext.query.trim()) {
        trackClick({
          queryText: currentSearchContext.query,
          clickedDocId: result.id,
          clickedDocType: result.type,
          rankPosition,
          ...(channelId !== undefined ? { channel: channelId } : {}),
          ...(resultUrl !== undefined ? { resultUrl } : {}),
        });
      }
    },
    [trackClick, currentSearchContext.query],
  );

  /**
   * Track search impressions when results are displayed
   */
  useEffect(() => {
    if (!searchSessionId || !text.trim()) {
      return;
    }

    const currentLength = text.trim().length;
    const previousLength = prevSearchTextLengthRef.current;

    // Only track impressions when user is actively typing (adding text)
    if (currentLength <= previousLength) {
      prevSearchTextLengthRef.current = currentLength;
      return;
    }

    // Calculate facet counts from results (backend results)
    const facetCounts: Record<string, number> = {};
    searchResults.forEach(result => {
      facetCounts[result.type] = (facetCounts[result.type] || 0) + 1;
    });

    // Add local channels to facet counts
    if (
      (currentSearchContext.activeTab === TabType.ALL ||
        currentSearchContext.activeTab === TabType.CHANNELS) &&
      currentSearchContext.localResultsCount > 0
    ) {
      facetCounts['channel'] =
        (facetCounts['channel'] || 0) + currentSearchContext.localResultsCount;
    }

    const totalHits = searchResults.length + currentSearchContext.localResultsCount;

    trackImpression({
      queryText: text,
      totalHits,
      facetCounts,
    });

    prevSearchTextLengthRef.current = currentLength;
  }, [searchSessionId, text, searchResults, trackImpression, currentSearchContext]);

  /**
   * Reset pagination and results
   */
  const resetSearchState = useCallback(() => {
    setSearchResults([]);
    setIsSearching(false);
    setSearchError(null);
    setCurrentSearchContext({
      query: '',
      activeTab: TabType.ALL,
      localResultsCount: 0,
      facetCounts: {},
    });
    resetImpressionTracking();
    setPaginationState({
      [TabType.ALL]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
      [TabType.USERS]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
      [TabType.CHANNELS]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
      [TabType.MESSAGES]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
      [TabType.TICKETS]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
      [TabType.ATTACHMENTS]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
    });
  }, [resetImpressionTracking]);

  /**
   * Perform Search
   */
  const performSearch = useCallback(
    async (
      query: string,
      activeTab: TabType,
      selectedMentions: Array<{ id: string; type: MentionType; prefix?: string }>,
      useVespaSearch: boolean,
      filteredLocalUsers: User[],
      filteredLocalChannelsCount: number, // New Argument
      onComplete?: (results: DisplaySearchResult[], query: string) => void,
    ) => {
      const {
        searchText,
        priority: priorityFilter,
        board: boardFilter,
        tags: tagsFilter,
        before: beforeFilter,
        after: afterFilter,
        on: onFilter,
        range: rangeFilter,
        stage: stageFilter,
        status: statusFilter,
        assignee: assigneeFilter,
      } = parseSearchFilters(query);

      // Adjust local results count logic for context
      // Note: filteredLocalChannelsCount is passed in. For user tab, we count users?
      // For now, respect the passed count for channels.
      let localCount = 0;
      if (activeTab === TabType.ALL || activeTab === TabType.CHANNELS) {
        localCount = filteredLocalChannelsCount;
      }

      setCurrentSearchContext({
        query: searchText,
        activeTab: activeTab,
        localResultsCount: localCount,
        facetCounts: {}, // Calculated in effect
      });

      // Check if any filters are active
      const hasFilters =
        priorityFilter ||
        boardFilter || //TODO: In commandChannelMenu
        tagsFilter ||
        beforeFilter ||
        afterFilter ||
        onFilter ||
        rangeFilter ||
        stageFilter ||
        statusFilter ||
        assigneeFilter ||
        selectedMentions.length > 0;

      if (activeTab === TabType.USERS) {
        const results = [
          ...filteredLocalUsers.map((user: User) => ({
            id: user.id,
            type: 'user' as const,
            title: user.name,
            subtitle: user.email || '',
            relevanceScore: 1,
            metadata: {},
          })),
        ];
        setSearchResults(results);
        setPaginationState(prev => ({
          ...prev,
          [activeTab]: {
            page: 1,
            hasMore: true,
            total: results.length,
            offset: 0,
            cumulativeCount: results.length,
          },
        }));
      } else if ((searchText || hasFilters) && activeTab !== TabType.CHANNELS) {
        setIsSearching(true);
        setSearchError(null);
        markSearchStart();

        const shouldUseVespa = useVespaSearch;
        pendingSearchCountRef.current += 1;

        try {
          if (shouldUseVespa) {
            const limit = BACKEND_RESULTS_LIMIT;
            const apps = `${VespaApps.CHAT},${VespaApps.TICKET}`;
            const searchFilters: VespaSearchFilters = {
              query: searchText,
              apps: apps,
              offset: 0,
              limit: limit,
              filterOnly: !searchText && !!hasFilters,
              ...(priorityFilter && { priority: priorityFilter }),
              ...(boardFilter && { board: boardFilter }),
              ...(tagsFilter && { tags: tagsFilter }),
              ...(beforeFilter && { before: beforeFilter }),
              ...(afterFilter && { after: afterFilter }),
              ...(onFilter && { on: onFilter }),
              ...(rangeFilter && { range: rangeFilter }),
              ...(stageFilter && { stage: stageFilter }),
              ...(statusFilter && { status: statusFilter }),
              ...(assigneeFilter && { assignee: assigneeFilter }),
            };

            if (activeTab === TabType.MESSAGES) {
              searchFilters.type = VespaDocTypes.MESSAGES;
              searchFilters.apps = VespaApps.CHAT;
            } else if (activeTab === TabType.ATTACHMENTS) {
              searchFilters.type = VespaDocTypes.ATTACHMENTS;
              searchFilters.apps = VespaApps.CHAT;
            } else if (activeTab === TabType.TICKETS) {
              searchFilters.type = VespaDocTypes.TICKETS;
              searchFilters.apps = VespaApps.TICKET;
            }

            const userMentions = selectedMentions.filter(m => m.type === MentionType.USER);

            // Separate mentions by prefix
            const fromMentions = userMentions.filter(m => m.prefix === 'from:' || !m.prefix);
            const assigneeMentions = userMentions.filter(m => m.prefix === 'assignee:');

            if (fromMentions.length > 0) {
              searchFilters.from = fromMentions.map(user => user.id).join(',');
            }

            if (assigneeMentions.length > 0) {
              searchFilters.assignee = assigneeMentions.map(user => user.id).join(',');
            }

            const channelMentions = selectedMentions.filter(m => m.type === MentionType.CHANNEL);
            if (channelMentions.length > 0) {
              searchFilters.in = channelMentions.map(m => m.id).join(',');
            }

            let mergedResults: DisplaySearchResult[] = [];
            let totalCount = 0;
            let currentOffset = 0;
            let hasMore = false;

            if (activeTab === TabType.ALL) {
              const currentSessionId = searchSessionId || '';
              const vespaResponse = await searchService.vespaSearch({
                ...searchFilters,
                searchId: currentSessionId,
              });

              mergedResults = [
                ...filteredLocalUsers.map((user: User) => ({
                  id: user.id,
                  type: 'user' as const,
                  title: user.name,
                  subtitle: user.email || '',
                  relevanceScore: 1,
                  metadata: {},
                })),
                ...vespaResponse.results,
              ];
              totalCount = vespaResponse.totalCount + filteredLocalUsers.length;
              currentOffset = vespaResponse.limit;
              hasMore = false;
            } else {
              const currentSessionId = searchSessionId || '';
              const results = await searchService.vespaSearch({
                ...searchFilters,
                searchId: currentSessionId,
              });
              mergedResults = results.results;
              totalCount = results.totalCount;
              currentOffset = results.limit;
              hasMore = currentOffset < totalCount;
            }

            setSearchResults(mergedResults);
            latestResultsRef.current = mergedResults;

            setPaginationState(prev => ({
              ...prev,
              [activeTab]: {
                page: 1,
                hasMore,
                total: totalCount,
                offset: currentOffset,
                cumulativeCount: mergedResults.length,
              },
            }));
          } else {
            // PG Search (Fallback)
            const entityTypes: SearchableEntityType[] = [];

            if (activeTab === TabType.ALL) {
              entityTypes.push(
                SearchableEntityType.MESSAGES,
                SearchableEntityType.TICKETS,
                SearchableEntityType.ATTACHMENTS,
              );
            } else if (activeTab === TabType.MESSAGES) {
              entityTypes.push(SearchableEntityType.MESSAGES);
            } else if (activeTab === TabType.TICKETS) {
              entityTypes.push(SearchableEntityType.TICKETS);
            } else if (activeTab === TabType.ATTACHMENTS) {
              entityTypes.push(SearchableEntityType.ATTACHMENTS);
            }

            if (entityTypes.length > 0) {
              const limit = BACKEND_RESULTS_LIMIT;
              const searchFilters: GlobalSearchFilters = {
                query: searchText,
                entityTypes,
                page: 1,
                limit,
              };

              const userMentions = selectedMentions.filter(m => m.type === MentionType.USER);
              if (userMentions.length > 0) {
                searchFilters.userIds = userMentions.map(user => user.id);
              }

              const channelMentions = selectedMentions.filter(m => m.type === MentionType.CHANNEL);
              if (channelMentions.length > 0) {
                searchFilters.channelIds = channelMentions.map(m => m.id);
              }

              const searchResults = await searchService.globalSearch(searchFilters);
              const displayResults = searchService.transformToDisplayResults(searchResults.results);

              let finalResults = [];
              if (activeTab === TabType.ALL) {
                finalResults = [
                  ...filteredLocalUsers.map((user: User) => ({
                    id: user.id,
                    type: 'user' as const,
                    title: user.name,
                    subtitle: user.email || '',
                    relevanceScore: 1,
                    metadata: {},
                  })),
                  ...displayResults,
                ];
              } else {
                finalResults = displayResults;
              }

              setSearchResults(finalResults);

              mixpanelService.track(EVENTS.SEARCH_PERFORMED, {
                searchType: EVENT_PROPERTIES.SEARCH_TYPES.COMMAND_MENU,
                searchCategory: activeTab,
                resultsCount: displayResults.length,
              });

              setPaginationState(prev => ({
                ...prev,
                [activeTab]: {
                  page: 1,
                  hasMore: activeTab === TabType.ALL ? false : searchResults.pagination.hasMore,
                  total: searchResults.pagination.total,
                  offset: 0,
                  cumulativeCount: finalResults.length,
                },
              }));
            } else {
              setSearchResults([]);
            }
          }
        } catch (searchError) {
          setSearchError(searchError instanceof Error ? searchError.message : 'Search failed');
          setSearchResults([]);
        } finally {
          setIsSearching(false);
          pendingSearchCountRef.current -= 1;
          if (
            pendingSearchCountRef.current === 0 &&
            latestResultsRef.current.length > 0 &&
            onComplete
          ) {
            onComplete(latestResultsRef.current, searchText);
          }
        }
      } else {
        resetSearchState();
      }
    },
    [searchSessionId, markSearchStart, resetSearchState],
  );

  // Debounced backend search with pagination reset
  useEffect(() => {
    // Skip if channel or empty search (unless not on channels tab)
    // Actually logic from component was:
    // if (!searchText.trim() && activeTab !== TabType.CHANNELS) return;
    // but the hook can just handle it.

    const timer = setTimeout(() => {
      void performSearch(
        text,
        activeTab,
        selectedMentions,
        useVespaSearch,
        filteredLocalUsers,
        filteredLocalChannels.length,
        // We can pass onComplete if needed, but for now it's optional
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [
    text,
    activeTab,
    selectedMentions,
    useVespaSearch,
    filteredLocalUsers, // Should be stable or memoized if possible, but it comes from useUserSearch which memos
    // filteredLocalChannels.length - use length to avoid deep dep
    filteredLocalChannels.length,
  ]);

  /**
   * Load More Results
   */
  const loadMoreResults = useCallback(async () => {
    const {
      searchText,
      priority: priorityFilter,
      board: boardFilter,
      tags: tagsFilter,
      before: beforeFilter,
      after: afterFilter,
      on: onFilter,
      range: rangeFilter,
      stage: stageFilter,
      status: statusFilter,
      assignee: assigneeFilter,
    } = parseSearchFilters(text);

    const hasFilters =
      priorityFilter ||
      boardFilter ||
      tagsFilter ||
      beforeFilter ||
      afterFilter ||
      onFilter ||
      rangeFilter ||
      stageFilter ||
      statusFilter ||
      assigneeFilter;

    if (isLoadingMore || (!searchText && !hasFilters) || activeTab === TabType.CHANNELS) return;

    const currentPagination = paginationState[activeTab];
    if (!currentPagination.hasMore) return;

    const shouldUseVespa = useVespaSearch && activeTab !== 'users';
    setIsLoadingMore(true);

    try {
      if (shouldUseVespa) {
        const currentOffset = currentPagination.offset;
        const pageSize = BACKEND_RESULTS_LIMIT;

        const searchFilters: VespaSearchFilters = {
          query: searchText,
          apps: `${VespaApps.CHAT},${VespaApps.TICKET}`,
          offset: currentOffset,
          limit: currentOffset + pageSize,
          filterOnly: !searchText && !!hasFilters,
          ...(priorityFilter && { priority: priorityFilter }),
          ...(boardFilter && { board: boardFilter }),
          ...(tagsFilter && { tags: tagsFilter }),
          ...(beforeFilter && { before: beforeFilter }),
          ...(afterFilter && { after: afterFilter }),
          ...(onFilter && { on: onFilter }),
          ...(rangeFilter && { range: rangeFilter }),
          ...(stageFilter && { stage: stageFilter }),
          ...(statusFilter && { status: statusFilter }),
          ...(assigneeFilter && { assignee: assigneeFilter }),
        };

        if (activeTab === TabType.MESSAGES) {
          searchFilters.type = VespaDocTypes.MESSAGES;
          searchFilters.apps = VespaApps.CHAT;
        } else if (activeTab === TabType.ATTACHMENTS) {
          searchFilters.type = VespaDocTypes.ATTACHMENTS;
          searchFilters.apps = VespaApps.CHAT;
        } else if (activeTab === TabType.TICKETS) {
          searchFilters.type = VespaDocTypes.TICKETS;
          searchFilters.apps = VespaApps.TICKET;
        }

        const userMentions = selectedMentions.filter(m => m.type === MentionType.USER);

        // Separate mentions by prefix
        const fromMentions = userMentions.filter(m => m.prefix === 'from:' || !m.prefix);
        const assigneeMentions = userMentions.filter(m => m.prefix === 'assignee:');

        if (fromMentions.length > 0) {
          searchFilters.from = fromMentions.map(user => user.id).join(',');
        }

        if (assigneeMentions.length > 0) {
          searchFilters.assignee = assigneeMentions.map(user => user.id).join(',');
        }

        const channelMentions = selectedMentions.filter(m => m.type === MentionType.CHANNEL);
        if (channelMentions.length > 0) {
          searchFilters.in = channelMentions.map(m => m.id).join(',');
        }

        const currentSessionId = searchSessionId || '';
        const results = await searchService.vespaSearch({
          ...searchFilters,
          searchId: currentSessionId,
        });
        setSearchResults(prev => [...prev, ...results.results]);

        const newOffset = results.limit;
        const hasMore = newOffset < results.totalCount;

        setPaginationState(prev => ({
          ...prev,
          [activeTab]: {
            ...prev[activeTab],
            hasMore,
            total: results.totalCount,
            offset: newOffset,
            cumulativeCount: prev[activeTab].cumulativeCount + results.results.length,
          },
        }));
      } else {
        // PG Load More
        const entityTypes: SearchableEntityType[] = [];
        if (activeTab === TabType.ALL) {
          entityTypes.push(
            SearchableEntityType.MESSAGES,
            SearchableEntityType.TICKETS,
            SearchableEntityType.ATTACHMENTS,
          );
        } else if (activeTab === TabType.MESSAGES) {
          entityTypes.push(SearchableEntityType.MESSAGES);
        } else if (activeTab === TabType.TICKETS) {
          entityTypes.push(SearchableEntityType.TICKETS);
        } else if (activeTab === TabType.ATTACHMENTS) {
          entityTypes.push(SearchableEntityType.ATTACHMENTS);
        }

        if (entityTypes.length > 0) {
          const nextPage = currentPagination.page + 1;
          const searchFilters: GlobalSearchFilters = {
            query: searchText || text.trim(),
            entityTypes,
            page: nextPage,
            limit: BACKEND_RESULTS_LIMIT,
          };

          const userMentions = selectedMentions.filter(m => m.type === MentionType.USER);
          if (userMentions.length > 0) {
            searchFilters.userIds = userMentions.map(m => m.id);
          }

          const channelMentions = selectedMentions.filter(m => m.type === MentionType.CHANNEL);
          if (channelMentions.length > 0) {
            searchFilters.channelIds = channelMentions.map(m => m.id);
          }

          const searchResults = await searchService.globalSearch(searchFilters);
          const displayResults = searchService.transformToDisplayResults(searchResults.results);
          setSearchResults(prev => [...prev, ...displayResults]);

          setPaginationState(prev => ({
            ...prev,
            [activeTab]: {
              page: nextPage,
              hasMore: searchResults.pagination.hasMore,
              total: searchResults.pagination.total,
              offset: 0,
              cumulativeCount: prev[activeTab].cumulativeCount + displayResults.length,
            },
          }));
        }
      }
    } catch (searchError) {
      console.error('Failed to load more results:', searchError);
    } finally {
      setIsLoadingMore(false);
    }
  }, [
    isLoadingMore,
    paginationState,
    searchSessionId,
    text,
    activeTab,
    selectedMentions,
    useVespaSearch,
  ]);

  // Load more results wrapper for effect
  const loadMore = useCallback(async () => {
    await loadMoreResults();
  }, [loadMoreResults]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          void loadMore();
        }
      },
      { threshold: 0.1 },
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [loadMore]);

  useEffect(() => {
    // Skip tracking on initial mount
    if (previousTabRef.current === activeTab) {
      return;
    }

    previousTabRef.current = activeTab;

    if (!searchSessionId) {
      return;
    }
    currentSearchContext.activeTab = activeTab;
    // Track the tab change
    searchMetricsService.trackTabClick({
      searchSessionId,
      userId: String(context.userID),
      tab: previousTabRef.current,
    });
  }, [searchSessionId, context.userID, activeTab]);

  /**
   * Cleanup on unmount
   * Only runs when the component unmounts, not when sessionId changes.
   * This prevents premature session cleanup when starting a new session.
   */
  useEffect(() => {
    return () => {
      // endSession internally checks if there's an active sessionId
      if (searchSessionId) {
        endSession('abandon');
      }
    };
  }, []); // Empty dependency array = only runs on mount/unmount

  return {
    // Session state
    searchSessionId,

    // Actions
    onOpen,
    onClose,
    onResultClick,
    setScrollContainer,
    setText,

    // New State/Refs exposed
    activeTab,
    setActiveTab,
    selectedMentions,
    setSelectedMentions,
    useVespaSearch,
    setUseVespaSearch,
    loadMoreRef,
    filteredLocalUsers,
    filteredLocalChannels,

    // Input state
    text,
    inputRef,

    searchResults,
    isSearching,
    searchError,
    isLoadingMore,
    paginationState,
    resetSearchState,
  };
}
