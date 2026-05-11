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
  SearchableTypes,
} from '../components/Chat/ChatDirectory/ChannelCommandMenu.types';
import { User } from '../machines/stateMachine';
import { Channel } from '@xyne/shared';
import { useUserSearch } from './useUsers';
import { searchChannels } from './useChannels';
import { ChannelCategory } from '../components/Chat/ChatDirectory/ChatDirectory.types';
import { isDMChannel } from '../components/Chat/ChatDirectory/ChatDirectory.utils';
import {
  parseSearchFilters,
  parseTypeFilter,
  hasLocalTypeFilter,
  hasIncompleteType,
  getBackendTypes,
  hasActiveMentionFilter,
} from '../utils/searchFilterParser';
import { sudoQueryService } from '../services/hyperAnalytics/sudoQueryService';

type SearchTrigger = 'keyboard_shortcut' | 'click' | 'auto_focus';
type SearchLocation = 'global' | 'channel' | 'dm';
type QuerySource = 'KEYBOARD' | 'CLIPBOARD_PASTE';

interface UseSearchMetricsOptions {
  searchLocation?: SearchLocation;
  allChannels?: Array<{ channel: Channel; category: ChannelCategory; searchableNames?: string[] }>;
  onSearchComplete?: (results: DisplaySearchResult[], query: string) => void;
  mentionSearchType?: MentionType | null;
}

const BACKEND_RESULTS_LIMIT = 25;

/**
 * Cap on user rows fetched for any Cmd+K user surface (plain-search USERS
 * section, and `from:` typeahead). Both surfaces use the same value so a
 * query like "abhi" returns the same set of candidates regardless of how
 * the user typed it.
 */
export const CMDK_USER_LIMIT = 25;

/**
 * Rank Cmd+K user candidates:
 *   1. name-prefix matches first
 *   2. DM-contact users within each tier
 *   3. tie-break by DM recency (smaller index = more recent activity), so
 *      `from:` with no text shows the same people-you-talk-to-most order
 *      that the plain-search empty state shows in the DIRECT MESSAGES
 *      section.
 *
 * `dmContactRecency` maps a user ID to its position in the recency-ordered
 * 1:1 DM list (0 = most recent). Users not in the map fall through to the
 * incoming alphabetical order from `searchUsers`.
 */
export function rankUsers<T extends { id: string; name: string }>(
  users: T[],
  query: string,
  dmContactRecency: Map<string, number>,
): T[] {
  const q = query.toLowerCase().trim();
  const isPrefixMatch = (name: string): boolean => !!q && name.toLowerCase().startsWith(q);

  const rank = (user: T): number => {
    const primary = isPrefixMatch(user.name);
    const hasDM = dmContactRecency.has(user.id);
    if (primary && hasDM) return 0;
    if (primary) return 1;
    if (hasDM) return 2;
    return 3;
  };

  // Stable sort (ES2019+) preserves the incoming `searchUsers` order
  // (alphabetical for non-DM users) when both rank and recency are equal.
  return [...users].sort((a, b) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    const aRecency = dmContactRecency.get(a.id);
    const bRecency = dmContactRecency.get(b.id);
    if (aRecency !== undefined && bRecency !== undefined) return aRecency - bRecency;
    return 0;
  });
}

/**
 * Filter channel entries for Cmd+K search.
 *
 * DMs/Group DMs match against `searchableNames` (participant display names)
 * with AND-semantics: every comma/whitespace-separated token must match some
 * participant. Regular channels defer to `searchChannels` for fuzzy +
 * hyphen-strip behaviour shared with the rest of the app.
 *
 * Cmd+K-scoped (the participant-name match path is specific to the command
 * menu's grouped layout). Used by `filteredLocalChannels` below and by the
 * `in:` / `#` typeahead in ChannelCommandMenu.
 *
 * @param options.excludeDMs  Drop DMs/Group DMs entirely — used by the `#`
 *   Slack-style quick switcher which should show only regular channels.
 */
export function filterChannelsBySearchableNames<
  T extends { channel: Channel; searchableNames?: string[] },
>(items: T[], query: string, options: { excludeDMs?: boolean } = {}): T[] {
  const scoped = options.excludeDMs
    ? items.filter(({ channel }) => !isDMChannel(channel.scopeType))
    : items;

  const searchLower = query.toLowerCase().trim();
  if (!searchLower) return scoped;

  const dmItems = scoped.filter(({ channel }) => isDMChannel(channel.scopeType));
  const regularItems = scoped.filter(({ channel }) => !isDMChannel(channel.scopeType));

  const queryParts = searchLower
    .split(/[,\s]+/)
    .map(p => p.trim())
    .filter(Boolean);

  const matchedDms = dmItems.filter(({ searchableNames }) => {
    if (!searchableNames || searchableNames.length === 0 || queryParts.length === 0) return false;
    const namesLower = searchableNames.map(n => n.toLowerCase());
    return queryParts.every(part => namesLower.some(name => name.includes(part)));
  });

  const regularChannels = regularItems.map(item => item.channel);
  const matchedIds = new Set(
    searchChannels(regularChannels, query, regularChannels.length).map(c => c.id),
  );
  const matchedRegular = regularItems.filter(({ channel }) => matchedIds.has(channel.id));

  return [...matchedDms, ...matchedRegular];
}

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

  // Clipboard tracking state
  const querySourceRef = useRef<QuerySource>('KEYBOARD');
  const isModifiedRef = useRef<boolean>(false);

  // Search Input State
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Parse filters early for UI visibility (typeFilter) and cleaned searchText
  const parsedFilters = useMemo(() => parseSearchFilters(text), [text]);
  const { searchText: cleanedSearchText, type: typeFilter } = parsedFilters;

  // New State moved from ChannelCommandMenu
  const [activeTab, setActiveTab] = useState<TabType>(TabType.ALL);
  const [selectedMentions, setSelectedMentions] = useState<
    Array<{ id: string; type: MentionType; prefix?: string }>
  >([]);
  const [useVespaSearch, setUseVespaSearch] = useState(true);
  // Cmd-K "Include bot messages" toggle. Default OFF → backend excludes BOT messages.
  const [includeBotMessages, setIncludeBotMessages] = useState(false);

  // Load More Ref
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Filter local users using the search hook - use cleaned searchText
  const filteredLocalUsers = useUserSearch(cleanedSearchText, CMDK_USER_LIMIT);

  // Filter local channels - use cleaned searchText
  const filteredLocalChannels: Array<{
    channel: Channel;
    category: ChannelCategory;
    searchableNames?: string[];
  }> = useMemo(
    () => filterChannelsBySearchableNames(options.allChannels ?? [], cleanedSearchText),
    [options.allChannels, cleanedSearchText],
  );

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
    [TabType.CANVAS]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
    [TabType.CALL]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
    [TabType.RECORDING]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
    [TabType.DESK]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
  });

  const pendingSearchCountRef = useRef(0);
  const latestResultsRef = useRef<DisplaySearchResult[]>([]);
  const sessionFiltersRef = useRef<Set<string>>(new Set());

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

      // Reset clipboard tracking for new session
      querySourceRef.current = 'KEYBOARD';
      isModifiedRef.current = false;

      // Reset session filters tracking
      sessionFiltersRef.current.clear();

      searchMetricsService.trackSessionStart(
        newSessionId,
        String(context.userID),
        previousTabRef.current,
      );
      sudoQueryService.track('search_session_start', {
        searchSessionId: newSessionId,
        tab: previousTabRef.current,
        trigger,
      });

      return newSessionId;
    },
    [generateSearchSessionId, context.userID],
  );

  /**
   * Handle paste detected in search input
   * Sets query_source to CLIPBOARD_PASTE and resets is_modified to false
   */
  const handlePasteDetected = useCallback(() => {
    querySourceRef.current = 'CLIPBOARD_PASTE';
    isModifiedRef.current = false;
  }, []);

  /**
   * Handle manual keystroke detected after paste
   * Flips is_modified to true
   */
  const handleManualKeystroke = useCallback(() => {
    if (querySourceRef.current === 'CLIPBOARD_PASTE') {
      isModifiedRef.current = true;
    }
  }, []);

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

      // Use accumulated unique filters from entire session
      const filtersUsed = sessionFiltersRef.current.size;
      const hasFilters = filtersUsed > 0;
      const filtersUsedList = Array.from(sessionFiltersRef.current);

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
          querySource: querySourceRef.current,
          isModified: isModifiedRef.current,
          tab: previousTabRef.current,
        });
        sudoQueryService.track('search_session_end', {
          searchSessionId,
          queryText: queryTextForEnd || '',
          totalImpressions: impressionCountRef.current,
          dwellTimeMs,
          endReason,
          totalSessionDurationMs,
          querySource: querySourceRef.current,
          isModified: isModifiedRef.current,
          tab: previousTabRef.current,
          filtersUsed,
          hasFilters,
          filtersUsedList,
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

      // Reset clipboard tracking
      querySourceRef.current = 'KEYBOARD';
      isModifiedRef.current = false;
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
        querySource: querySourceRef.current,
        isModified: isModifiedRef.current,
        ...(options.searchLocation && { searchLocation: options.searchLocation }),
        tab: previousTabRef.current,
      });
      sudoQueryService.track('search_impression', {
        searchSessionId,
        queryText: params.queryText,
        totalHits: params.totalHits,
        latencyMs,
        ...Object.entries(params.facetCounts).reduce(
          (acc, [key, value]) => {
            acc[`facetCount_${key}`] = value;
            return acc;
          },
          {} as Record<string, number>,
        ),
        searchTrigger: searchTriggerRef.current,
        querySource: querySourceRef.current,
        isModified: isModifiedRef.current,
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

      // Accumulate unique filters used during session
      const parsedFiltersForImpression = parseSearchFilters(params.queryText);

      if (parsedFiltersForImpression.priority) sessionFiltersRef.current.add('priority');
      if (parsedFiltersForImpression.board) sessionFiltersRef.current.add('board');
      if (parsedFiltersForImpression.tags) sessionFiltersRef.current.add('tags');
      if (parsedFiltersForImpression.before) sessionFiltersRef.current.add('before');
      if (parsedFiltersForImpression.after) sessionFiltersRef.current.add('after');
      if (parsedFiltersForImpression.on) sessionFiltersRef.current.add('on');
      if (parsedFiltersForImpression.range) sessionFiltersRef.current.add('range');
      if (parsedFiltersForImpression.stage) sessionFiltersRef.current.add('stage');
      if (parsedFiltersForImpression.status) sessionFiltersRef.current.add('status');
      if (parsedFiltersForImpression.type) sessionFiltersRef.current.add('type');

      // Track mention-based filters
      const hasFromMention = selectedMentions.some(
        m => m.type === MentionType.USER && (m.prefix === 'from:' || !m.prefix),
      );
      const hasWithMention = selectedMentions.some(
        m => m.type === MentionType.USER && m.prefix === 'with:',
      );
      const hasAssigneeMention = selectedMentions.some(
        m => m.type === MentionType.USER && m.prefix === 'assignee:',
      );
      const hasChannelMention = selectedMentions.some(m => m.type === MentionType.CHANNEL);
      if (hasFromMention) sessionFiltersRef.current.add('from');
      if (hasWithMention) sessionFiltersRef.current.add('with');
      if (hasAssigneeMention) sessionFiltersRef.current.add('assignee');
      if (hasChannelMention) sessionFiltersRef.current.add('in');

      // Reset for next search
      impressionStartTimeRef.current = 0;
    },
    [searchSessionId, context.userID, options.searchLocation, selectedMentions],
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
      isPreview?: boolean;
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
      sudoQueryService.track('search_click', {
        searchSessionId,
        queryText: params.queryText,
        clickedDocId: params.clickedDocId,
        clickedDocType: params.clickedDocType,
        rankPosition: params.rankPosition,
        ...(params.channel && { channel: params.channel }),
        ...(scrollDepth !== undefined && { scrollDepth }),
        ...(params.resultUrl && { resultUrl: params.resultUrl }),
        tab: previousTabRef.current,
        isPreview: params.isPreview ?? false,
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
    (
      result: DisplaySearchResult,
      rankPosition: number,
      channelId?: string,
      resultUrl?: string,
      isPreview?: boolean,
    ) => {
      trackClick({
        queryText: currentSearchContext.query,
        clickedDocId: result.id,
        clickedDocType: result.type,
        rankPosition,
        ...(channelId !== undefined ? { channel: channelId } : {}),
        ...(resultUrl !== undefined ? { resultUrl } : {}),
        isPreview: isPreview ?? false,
      });
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
      [TabType.CANVAS]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
      [TabType.CALL]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
      [TabType.RECORDING]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
      [TabType.DESK]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
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
      filteredLocalChannels: Array<{
        channel: Channel;
        category: ChannelCategory;
        searchableNames?: string[];
      }>,
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
        type: typeFilter,
      } = parseSearchFilters(query);

      // Adjust local results count logic for context
      let localCount = 0;
      if (activeTab === TabType.ALL || activeTab === TabType.CHANNELS) {
        localCount = filteredLocalChannels.length;
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
        boardFilter ||
        tagsFilter ||
        beforeFilter ||
        afterFilter ||
        onFilter ||
        rangeFilter ||
        stageFilter ||
        statusFilter ||
        typeFilter ||
        selectedMentions.length > 0;

      // Handle type filter - users/channels use filtered local results (shown as grouped in UI)
      const types = parseTypeFilter(typeFilter);
      const hasLocalType = hasLocalTypeFilter(types);
      const isIncomplete = hasIncompleteType(types);

      if (hasLocalType || isIncomplete) {
        // Return empty results - users/channels are shown via filteredLocalUsers/filteredLocalChannels
        setSearchResults([]);
        setPaginationState(prev => ({
          ...prev,
          [activeTab]: {
            page: 1,
            hasMore: false,
            total: 0,
            offset: 0,
            cumulativeCount: 0,
          },
        }));
      } else if (typeFilter && getBackendTypes(types).length === 0) {
        // Invalid type filter (e.g., type:foobar) — no valid types to search
        setSearchResults([]);
        setPaginationState(prev => ({
          ...prev,
          [activeTab]: {
            page: 1,
            hasMore: false,
            total: 0,
            offset: 0,
            cumulativeCount: 0,
          },
        }));
        setIsSearching(false);
        pendingSearchCountRef.current -= 1;
        return;
      } else if (activeTab === TabType.USERS) {
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
      } else if (hasActiveMentionFilter(query, selectedMentions)) {
        setSearchResults([]);
        setPaginationState(prev => ({
          ...prev,
          [activeTab]: {
            page: 1,
            hasMore: false,
            total: 0,
            offset: 0,
            cumulativeCount: 0,
          },
        }));
        setIsSearching(false);
        pendingSearchCountRef.current -= 1;
        return;
      } else if (searchText || hasFilters) {
        setIsSearching(true);
        setSearchError(null);
        markSearchStart();

        const shouldUseVespa = useVespaSearch;
        pendingSearchCountRef.current += 1;

        try {
          if (shouldUseVespa) {
            const limit = BACKEND_RESULTS_LIMIT;
            const apps = `${VespaApps.CHAT},${VespaApps.TICKET},${VespaApps.FILE},${VespaApps.MAIL}`;
            const searchFilters: VespaSearchFilters = {
              query: searchText,
              apps: apps,
              offset: 0,
              limit: limit,
              filterOnly: !searchText && !!hasFilters,
              includeBotMessages,
              ...(priorityFilter && { priority: priorityFilter }),
              ...(boardFilter && { board: boardFilter }),
              ...(tagsFilter && { tags: tagsFilter }),
              ...(beforeFilter && { before: beforeFilter }),
              ...(afterFilter && { after: afterFilter }),
              ...(onFilter && { on: onFilter }),
              ...(rangeFilter && { range: rangeFilter }),
              ...(stageFilter && { stage: stageFilter }),
              ...(statusFilter && { status: statusFilter }),
            };

            const userMentions = selectedMentions.filter(m => m.type === MentionType.USER);
            const fromMentions = userMentions.filter(m => m.prefix === 'from:' || !m.prefix);
            const assigneeMentions = userMentions.filter(m => m.prefix === 'assignee:');

            // Assignee filter doesn't apply to Messages/Attachments - return empty results
            if (
              assigneeMentions.length > 0 &&
              activeTab !== TabType.TICKETS &&
              activeTab !== TabType.ALL
            ) {
              setSearchResults([]);
              setPaginationState(prev => ({
                ...prev,
                [activeTab]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
              }));
              setIsSearching(false);
              pendingSearchCountRef.current -= 1;
              return;
            }

            // Handle type filter - only send backend-valid types (strip local types like users/people/channels)
            if (typeFilter) {
              const parsedTypes = parseTypeFilter(typeFilter);
              const backendTypes = getBackendTypes(parsedTypes);

              // Check for canvas/transcript types to set specific filters
              const hasCanvas = parsedTypes.includes('canvas');
              const hasTranscript = parsedTypes.includes('transcript');

              if (backendTypes.length > 0) {
                searchFilters.type = backendTypes.join(',');
              }

              // Override apps and set subApp for canvas/transcript specific searches
              if (hasCanvas && !hasTranscript) {
                // Only canvas - restrict to FILE app with CANVAS subApp
                searchFilters.apps = VespaApps.FILE;
                searchFilters.subApp = 'CANVAS';
              } else if (hasTranscript && !hasCanvas) {
                // Only transcript - restrict to FILE app with TRANSCRIPT subApp
                searchFilters.apps = VespaApps.FILE;
                searchFilters.subApp = 'transcript';
              }
              // If both canvas and transcript are specified, let the backend handle it naturally
            } else if (activeTab === TabType.MESSAGES) {
              searchFilters.type = VespaDocTypes.MESSAGES;
            } else if (activeTab === TabType.ATTACHMENTS) {
              searchFilters.type = VespaDocTypes.FILES;
            } else if (activeTab === TabType.TICKETS) {
              searchFilters.type = VespaDocTypes.TICKETS;
            } else if (activeTab === TabType.DESK) {
              searchFilters.type = SearchableTypes.EMAILS;
              searchFilters.apps = VespaApps.MAIL;
            } else if (activeTab === TabType.CANVAS) {
              searchFilters.type = 'canvas';
              searchFilters.apps = VespaApps.FILE;
            } else if (activeTab === TabType.CALL) {
              searchFilters.type = VespaDocTypes.FILES;
              searchFilters.apps = VespaApps.FILE;
              searchFilters.subApp = 'transcript';
            } else if (activeTab === TabType.RECORDING) {
              searchFilters.type = VespaDocTypes.FILES;
              searchFilters.apps = VespaApps.FILE;
              searchFilters.subApp = 'transcript';
              searchFilters.callType = 'HEADLESS';
            }

            // Add assignee filter for Tickets/ALL (force ticket-only search)
            if (assigneeMentions.length > 0) {
              searchFilters.type = VespaDocTypes.TICKETS;
              searchFilters.assignee = assigneeMentions.map(user => user.id).join(',');
            }

            if (fromMentions.length > 0) {
              searchFilters.from = fromMentions.map(user => user.id).join(',');
            }

            const withMentions = userMentions.filter(m => m.prefix === 'with:');
            if (withMentions.length > 0) {
              searchFilters.type = VespaDocTypes.MESSAGES;
              searchFilters.with = withMentions.map(user => user.id).join(',');
            }

            // With: filter doesn't apply to Files/Tickets/etc - return empty results for non-Messages tabs
            if (
              withMentions.length > 0 &&
              activeTab !== TabType.MESSAGES &&
              activeTab !== TabType.ALL
            ) {
              setSearchResults([]);
              setPaginationState(prev => ({
                ...prev,
                [activeTab]: { page: 1, hasMore: false, total: 0, offset: 0, cumulativeCount: 0 },
              }));
              setIsSearching(false);
              pendingSearchCountRef.current -= 1;
              return;
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
                presentationSummary: 'lean',
              });

              // Only merge local users when no type filter is applied
              if (typeFilter) {
                mergedResults = vespaResponse.results;
                totalCount = vespaResponse.totalCount;
              } else {
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
              }
              currentOffset = vespaResponse.limit;
              hasMore = false;
            } else {
              const currentSessionId = searchSessionId || '';
              const results = await searchService.vespaSearch({
                ...searchFilters,
                searchId: currentSessionId,
                presentationSummary: 'lean',
              });
              mergedResults = results.results;
              totalCount = results.totalCount;
              currentOffset = results.limit;
              hasMore =
                results.results.length > 0 &&
                results.results.length >= BACKEND_RESULTS_LIMIT &&
                currentOffset < totalCount;
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
    [searchSessionId, markSearchStart, resetSearchState, includeBotMessages],
  );

  // Track the last search text to avoid duplicate calls for trailing spaces
  const lastSearchedTextRef = useRef('');

  // Debounced backend search with pagination reset
  useEffect(() => {
    if (options.mentionSearchType) {
      return;
    }

    // Skip if channel or empty search (unless not on channels tab)
    // Actually logic from component was:
    // if (!searchText.trim() && activeTab !== TabType.CHANNELS) return;
    // but the hook can just handle it.

    // Normalize text by trimming trailing spaces to avoid duplicate API calls
    // "sak" and "sak   " should trigger the same search
    const normalizedText = text.trimEnd();

    // Skip if the normalized text is the same as the last searched text
    // This prevents unnecessary API calls when typing only spaces
    if (normalizedText === lastSearchedTextRef.current && normalizedText !== '') {
      return;
    }

    const timer = setTimeout(() => {
      lastSearchedTextRef.current = normalizedText;
      void performSearch(
        text,
        activeTab,
        selectedMentions,
        useVespaSearch,
        filteredLocalUsers,
        filteredLocalChannels,
        options.onSearchComplete,
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [
    text,
    activeTab,
    selectedMentions,
    useVespaSearch,
    filteredLocalUsers,
    filteredLocalChannels.length,
    options.onSearchComplete,
    options.mentionSearchType,
    performSearch,
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
      type: typeFilter,
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
      typeFilter ||
      selectedMentions.length > 0;

    // Check for local/incomplete types - don't call backend for users/channels or partial typing
    const loadMoreTypes = parseTypeFilter(typeFilter);
    if (hasLocalTypeFilter(loadMoreTypes) || hasIncompleteType(loadMoreTypes)) return;

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
          apps: `${VespaApps.CHAT},${VespaApps.TICKET},${VespaApps.FILE}`,
          offset: currentOffset,
          limit: currentOffset + pageSize,
          filterOnly: !searchText && !!hasFilters,
          includeBotMessages,
          ...(priorityFilter && { priority: priorityFilter }),
          ...(boardFilter && { board: boardFilter }),
          ...(tagsFilter && { tags: tagsFilter }),
          ...(beforeFilter && { before: beforeFilter }),
          ...(afterFilter && { after: afterFilter }),
          ...(onFilter && { on: onFilter }),
          ...(rangeFilter && { range: rangeFilter }),
          ...(stageFilter && { stage: stageFilter }),
          ...(statusFilter && { status: statusFilter }),
        };

        const userMentions = selectedMentions.filter(m => m.type === MentionType.USER);
        const fromMentions = userMentions.filter(m => m.prefix === 'from:' || !m.prefix);
        const assigneeMentions = userMentions.filter(m => m.prefix === 'assignee:');

        // Assignee filter doesn't apply to Messages/Attachments - return empty
        if (
          assigneeMentions.length > 0 &&
          activeTab !== TabType.TICKETS &&
          activeTab !== TabType.ALL
        ) {
          setIsLoadingMore(false);
          return;
        }

        const withMentions = userMentions.filter(m => m.prefix === 'with:');

        // With: filter doesn't apply to Files/Tickets/etc - return empty for non-Messages tabs
        if (
          withMentions.length > 0 &&
          activeTab !== TabType.MESSAGES &&
          activeTab !== TabType.ALL
        ) {
          setIsLoadingMore(false);
          return;
        }

        // Handle type filter - only send backend-valid types (strip local types like users/people/channels)
        if (typeFilter) {
          const backendTypes = getBackendTypes(parseTypeFilter(typeFilter));
          if (backendTypes.length > 0) {
            searchFilters.type = backendTypes.join(',');
          }
        } else if (activeTab === TabType.MESSAGES) {
          searchFilters.type = VespaDocTypes.MESSAGES;
        } else if (activeTab === TabType.ATTACHMENTS) {
          searchFilters.type = VespaDocTypes.FILES;
        } else if (activeTab === TabType.TICKETS) {
          searchFilters.type = VespaDocTypes.TICKETS;
        }

        // Add assignee filter for Tickets/ALL (force ticket-only search)
        if (assigneeMentions.length > 0) {
          searchFilters.type = VespaDocTypes.TICKETS;
          searchFilters.assignee = assigneeMentions.map(user => user.id).join(',');
        }

        if (fromMentions.length > 0) {
          searchFilters.from = fromMentions.map(user => user.id).join(',');
        }

        if (withMentions.length > 0) {
          searchFilters.type = VespaDocTypes.MESSAGES;
          searchFilters.with = withMentions.map(user => user.id).join(',');
        }

        const channelMentions = selectedMentions.filter(m => m.type === MentionType.CHANNEL);
        if (channelMentions.length > 0) {
          searchFilters.in = channelMentions.map(m => m.id).join(',');
        }

        const currentSessionId = searchSessionId || '';
        const results = await searchService.vespaSearch({
          ...searchFilters,
          searchId: currentSessionId,
          presentationSummary: 'lean',
        });
        setSearchResults(prev => [...prev, ...results.results]);

        const newOffset = results.limit;
        const hasMore =
          results.results.length > 0 &&
          results.results.length >= BACKEND_RESULTS_LIMIT &&
          newOffset < results.totalCount;

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
    includeBotMessages,
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
    sudoQueryService.track('search_tab_click', {
      searchSessionId,
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
    includeBotMessages,
    setIncludeBotMessages,
    loadMoreRef,
    filteredLocalUsers,
    filteredLocalChannels,
    typeFilter,

    // Input state
    text,
    searchText: cleanedSearchText,
    inputRef,

    // Clipboard tracking callbacks
    onPasteDetected: handlePasteDetected,
    onManualKeystroke: handleManualKeystroke,

    searchResults,
    isSearching,
    searchError,
    isLoadingMore,
    paginationState,
    resetSearchState,
  };
}
