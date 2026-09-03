import { logger, Event as LogEvent } from '../utils/logger';
import { useState, useCallback, useRef, useEffect, useMemo, useDeferredValue } from 'react';
import { searchMetricsService } from '../services/searchMetricsService';
import { useAuthContextValues } from './useAuth';
import { searchService, clearVespaSearchCache } from '../services/searchService';
import { DisplaySearchResult, VespaSearchFilters } from '../types/search';
import {
  TabType,
  ChipType,
  VespaApps,
  VespaDocTypes,
  SearchableTypes,
  getRelevantTabs,
  getRelevantAppsParam,
  filterChipToKind,
  type FilterKind,
} from '../components/Chat/ChatDirectory/ChannelCommandMenu.types';
import { User } from '../machines/stateMachine';
import { Channel } from '@xyne/shared';
import { useUserSearch } from './useUsers';
import { ChannelCategory } from '../components/Chat/ChatDirectory/ChatDirectory.types';
import { filterChannelsBySearchableNames } from '../utils/rankingUtils';
import {
  parseSearchFilters,
  parseTypeFilter,
  hasLocalTypeFilter,
  hasIncompleteType,
  getBackendTypes,
  hasActiveMentionFilter,
} from '../utils/searchFilterParser';
import { sudoQueryService } from '../services/hyperAnalytics/sudoQueryService';
import { affinityService } from '../services/affinityService';
import { useCmdkDefaultRankProfiles } from './useCmdkSearchConfig';
import type { StructuredSearchFilters } from './useSearchResultsScreen';

type SearchTrigger = 'keyboard_shortcut' | 'click' | 'auto_focus';
type SearchLocation = 'global' | 'channel' | 'dm';
type QuerySource = 'KEYBOARD' | 'CLIPBOARD_PASTE';

type SelectedMention = { id: string; type: ChipType; prefix?: string; name?: string };

type MentionBuckets = {
  from: SelectedMention[];
  with: SelectedMention[];
  assignee: SelectedMention[];
  to: SelectedMention[];
  mentions: SelectedMention[];
  in: SelectedMention[];
  channelMentions: SelectedMention[];
};

/**
 * Chip role (FilterKind) → its bucket. Bare @user/#channel (mention/channelMention) go to the
 * plural buckets; kinds absent here aren't bucketed (priority is read separately as priorityFilter).
 */
const FILTER_KIND_TO_BUCKET: Partial<Record<FilterKind, keyof MentionBuckets>> = {
  from: 'from',
  with: 'with',
  assignee: 'assignee',
  to: 'to',
  in: 'in',
  mention: 'mentions',
  channelMention: 'channelMentions',
};

/**
 * Split selected chips into search buckets, routing each via filterChipToKind (the shared chip
 * taxonomy in ChannelCommandMenu.types) so bucketing and the relevance registry can't drift.
 */
function deriveMentionBuckets(selectedMentions: SelectedMention[]): MentionBuckets {
  const buckets: MentionBuckets = {
    from: [],
    with: [],
    assignee: [],
    to: [],
    mentions: [],
    in: [],
    channelMentions: [],
  };
  for (const mention of selectedMentions) {
    const kind = filterChipToKind(mention);
    const bucket = kind ? FILTER_KIND_TO_BUCKET[kind] : undefined;
    if (bucket) buckets[bucket].push(mention);
  }
  return buckets;
}

interface UseSearchMetricsOptions {
  searchLocation?: SearchLocation;
  allChannels?: Array<{ channel: Channel; category: ChannelCategory; searchableNames?: string[] }>;
  onSearchComplete?: (results: DisplaySearchResult[], query: string) => void;
  mentionSearchType?: ChipType | null;
  isCallSearchPage?: boolean;
  // Initial value for the "Include my channels" toggle. Defaults to false so the
  // full-page search is unaffected; the Cmd-K modal opts in with `true`.
  defaultOnlyMyChannels?: boolean;
  // Initial value for the "Include automations" toggle. Set when reopening the palette
  // from a search whose scope had it on, so the restored search matches what was run.
  defaultIncludeBotMessages?: boolean;
  // When true, the ALL-tab Vespa query uses groupBy:'docType' so the backend
  // returns results bucketed by document type (≤10 per category) instead of a
  // flat ranked list — lets the ALL tab show a few of each type at once.
  // Ignored when the `unified` rank profile is selected, which needs a flat list.
  groupByDocType?: boolean;
}

const BACKEND_RESULTS_LIMIT = 25;
// Load-more uses a fixed-size window (constant `limit`, advancing `offset`). Vespa caps the
// query offset at maxOffset (1000), so stop paginating before `offset` would cross it.
const MAX_BACKEND_OFFSET = 1000;

/**
 * Cap on user rows fetched for any Cmd+K user surface (plain-search USERS
 * section, and `from:` typeahead). Both surfaces use the same value so a
 * query like "abhi" returns the same set of candidates regardless of how
 * the user typed it.
 */
export const CMDK_USER_LIMIT = 25;

/**
 * Text filters for a query, with UI-picked values layered on top. Typed syntax
 * (`status:todo`, `board:…`) keeps working; an explicit pick from the results page's
 * Filters popover wins for that field.
 */
function resolveTextFilters(
  query: string,
  overrides: StructuredSearchFilters,
): ReturnType<typeof parseSearchFilters> {
  const parsed = parseSearchFilters(query);
  return {
    ...parsed,
    board: overrides.board || parsed.board,
    tags: overrides.tags || parsed.tags,
    status: overrides.status || parsed.status,
    before: overrides.before || parsed.before,
    after: overrides.after || parsed.after,
    on: overrides.on || parsed.on,
    range: overrides.range || parsed.range,
  };
}

/**
 * Date bounds carried by chips rather than text. Dates are chips in the palette now, so
 * they no longer appear in the query for `parseSearchFilters` to find — without this the
 * date filter would render as a chip and quietly not be applied.
 */
function boardFilterFromChips(mentions: SelectedMention[]): StructuredSearchFilters {
  const boards = mentions.filter(m => m.type === ChipType.BOARD).map(m => m.id);
  return boards.length > 0 ? { board: boards.join(',') } : {};
}

function dateFiltersFromChips(mentions: SelectedMention[]): StructuredSearchFilters {
  const dates = mentions.filter(m => m.type === ChipType.DATE);
  if (dates.length === 0) return {};
  const on = dates.find(m => m.prefix === 'on:');
  if (on) return { on: on.id };
  const after = dates.find(m => m.prefix === 'after:')?.id;
  const before = dates.find(m => m.prefix === 'before:')?.id;
  return { ...(after ? { after } : {}), ...(before ? { before } : {}) };
}

export function useSearchMetrics(options: UseSearchMetricsOptions = {}) {
  const context = useAuthContextValues();
  const defaultRankProfileFor = useCmdkDefaultRankProfiles();

  useEffect(() => {
    void affinityService.prefetch();
  }, []);

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
  // Per-tab CAC default; an explicit user pick (rankProfile) wins.
  const allDefaultRankProfile = defaultRankProfileFor(activeTab);
  const [selectedMentions, setSelectedMentions] = useState<
    Array<{ id: string; type: ChipType; prefix?: string; name?: string }>
  >([]);
  // Cmd-K "Include bot messages" toggle. Default OFF → backend excludes BOT messages.
  const [includeBotMessages, setIncludeBotMessages] = useState(
    options.defaultIncludeBotMessages ?? false,
  );
  // Cmd-K "Include my channels" toggle. Modal opts in via `defaultOnlyMyChannels`;
  // other consumers (full-page search) default OFF so their behavior is unchanged.
  const [onlyMyChannels, setOnlyMyChannels] = useState(options.defaultOnlyMyChannels ?? false);
  // Vespa rank profile, passed through to the search payload. '' => backend default.
  const [rankProfile, setRankProfile] = useState('');
  // Structured filters picked from UI (the results page's Filters popover) rather than typed
  // into the query. Merged over whatever `parseSearchFilters` finds in the text, so typed
  // syntax keeps working and an explicit pick wins.
  const [structuredFilters, setStructuredFilters] = useState<StructuredSearchFilters>({});
  const structuredFiltersKey = JSON.stringify(structuredFilters);
  // Compare mode: request per-result matchfeatures/rankfeatures for ranking debug.
  const [includeDebugInfo, setIncludeDebugInfo] = useState(false);
  // Load More Ref
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Filter local users using the search hook - use cleaned searchText
  const filteredLocalUsers = useUserSearch(cleanedSearchText, CMDK_USER_LIMIT);

  // Decouple the (potentially expensive) local channel filter from the keystroke
  // that triggered it. The input value is bound to `text`, so it always echoes
  // instantly; deferring the value fed to the filter lets React keep the input
  // responsive and render the previous channel results until the new filter pass
  // is ready, instead of blocking each keystroke on the full DM Fuse pass.
  const deferredCleanedSearchText = useDeferredValue(cleanedSearchText);

  // Filter local channels - use the deferred cleaned searchText
  const filteredLocalChannels: Array<{
    channel: Channel;
    category: ChannelCategory;
    searchableNames?: string[];
  }> = useMemo(
    () => filterChannelsBySearchableNames(options.allChannels ?? [], deferredCleanedSearchText),
    [options.allChannels, deferredCleanedSearchText],
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
  // Whether the ALL-tab results should render as per-docType sections. Mirrors the
  // backend's `grouped` flag (true when Vespa grouped by docType, false for a flat
  // ranked list). Defaults true to preserve the sectioned ALL view.
  const [isGrouped, setIsGrouped] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  // Whether a search has been scheduled for the current inputs and hasn't settled yet.
  // Drives the initial loader. Armed in the debounce effect (whose dep array is the
  // canonical, lint-enforced list of search inputs) and disarmed when the latest
  // dispatch's performSearch settles — so it is immune to the synchronous-cache-hit
  // race that stranded the old render-body `isLoading` latch.
  const [isSearchPending, setIsSearchPending] = useState(false);
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
  // The query that produced latestResultsRef, so onComplete always receives a
  // matching pair. Without it a superseded run — which no longer commits its own
  // results — would hand the callback fresh results labelled with its stale query.
  const latestQueryRef = useRef('');
  const sessionFiltersRef = useRef<Set<string>>(new Set());
  // Guards out-of-order responses. Each dispatch claims the next sequence number at the
  // call site (alongside the abort below); only the latest run may commit its results, and
  // the same seq gates the loader disarm — so no separate loader counter is needed. A
  // slow/stale response (e.g. a partial `from` query resolving after the completed `from:`
  // filter) is discarded instead of overwriting fresh results with an empty payload.
  const searchSeqRef = useRef(0);
  // Cancels the previous in-flight vespaSearch when a newer search is dispatched.
  const searchAbortRef = useRef<AbortController | null>(null);

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

      // Priority is chip-only — track it from the chip, not parsed text.
      if (selectedMentions.some(m => m.type === ChipType.PRIORITY)) {
        sessionFiltersRef.current.add('priority');
      }
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
      const filterBuckets = deriveMentionBuckets(selectedMentions);
      if (filterBuckets.from.length) sessionFiltersRef.current.add('from');
      if (filterBuckets.with.length) sessionFiltersRef.current.add('with');
      if (filterBuckets.assignee.length) sessionFiltersRef.current.add('assignee');
      if (filterBuckets.mentions.length) sessionFiltersRef.current.add('mentions');
      if (filterBuckets.in.length) sessionFiltersRef.current.add('in');
      if (filterBuckets.channelMentions.length) sessionFiltersRef.current.add('channelMentions');

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
      relevanceScore?: number;
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
        ...(params.relevanceScore !== undefined && { relevanceScore: params.relevanceScore }),
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
        ...(params.relevanceScore !== undefined && { relevanceScore: params.relevanceScore }),
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
      // A fresh palette open must never reuse a previous session's cached search — only the
      // in-flight popup → full-screen → back handoff should. Back-navigation restores the
      // palette without calling onOpen, so its cached result survives.
      // debugger;
      clearVespaSearchCache();
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
        ...(result.relevanceScore !== undefined ? { relevanceScore: result.relevanceScore } : {}),
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
    // Clear the dedup guard's text so reopening the palette and re-entering the same query
    // (notably a paste of the last search) isn't skipped as a duplicate and re-runs the search.
    lastSearchedParamsRef.current.text = '';
    // Re-arm the loader latch: after a clear/close, re-entering a query must show the
    // spinner again rather than a stale "No results".
    setIsSearchPending(false);
  }, [resetImpressionTracking]);

  /**
   * Perform Search
   */
  const performSearch = useCallback(
    async (
      seq: number,
      abortController: AbortController,
      query: string,
      activeTab: TabType,
      selectedMentions: Array<{ id: string; type: ChipType; prefix?: string; name?: string }>,
      filteredLocalUsers: User[],
      filteredLocalChannels: Array<{
        channel: Channel;
        category: ChannelCategory;
        searchableNames?: string[];
      }>,
      onComplete?: (results: DisplaySearchResult[], query: string) => void,
    ) => {
      // Run identity (seq + abortController) is minted by the caller at dispatch time so the
      // loader disarm can reuse the same seq. A stale response fails isStale() and is dropped.
      const isStale = () => seq !== searchSeqRef.current;

      const {
        searchText,
        board: boardFilter,
        tags: tagsFilter,
        before: beforeFilter,
        after: afterFilter,
        on: onFilter,
        range: rangeFilter,
        stage: stageFilter,
        status: statusFilter,
        type: typeFilter,
      } = resolveTextFilters(query, {
        ...structuredFilters,
        ...dateFiltersFromChips(selectedMentions),
        ...boardFilterFromChips(selectedMentions),
      });

      // Priority is chip-only: value comes solely from the chip; raw `priority:` text
      // isn't a filter (falls through to full-text search).
      const priorityFilter = selectedMentions.find(m => m.type === ChipType.PRIORITY)?.id;

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

        pendingSearchCountRef.current += 1;

        try {
          {
            const limit = BACKEND_RESULTS_LIMIT;
            const apps = `${VespaApps.CHAT},${VespaApps.TICKET},${VespaApps.FILE},${VespaApps.MAIL}`;
            const effectiveRankProfile = rankProfile || allDefaultRankProfile;
            const searchFilters: VespaSearchFilters = {
              query: searchText,
              apps: apps,
              offset: 0,
              limit: limit,
              filterOnly: !searchText && !!hasFilters,
              includeBotMessages,
              onlyMyChannels,
              ...(effectiveRankProfile && { rankProfile: effectiveRankProfile }),
              ...(includeDebugInfo && { includeDebugInfo: true }),
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

            const buckets = deriveMentionBuckets(selectedMentions);
            const fromMentions = buckets.from;
            const withMentions = buckets.with;
            const assigneeMentions = buckets.assignee;
            const mentionUserMentions = buckets.mentions;
            const inChannels = buckets.in;
            const mentionChannels = buckets.channelMentions;
            // Bare @user/#channel filters only exist on chat messages. `with:` also
            // filters call participants on the Call History search page.
            const hasMessageOnlyMention =
              (!options.isCallSearchPage && withMentions.length > 0) ||
              mentionUserMentions.length > 0 ||
              mentionChannels.length > 0;

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
            } else if (options.isCallSearchPage) {
              searchFilters.apps = VespaApps.CALL;
              searchFilters.type = VespaDocTypes.CALLS;
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

            const fromUserIds = fromMentions.filter(m => !m.id.includes('@')).map(m => m.id);
            const fromEmails = fromMentions.filter(m => m.id.includes('@')).map(m => m.id);
            if (fromUserIds.length > 0) searchFilters.from = fromUserIds.join(',');
            if (fromEmails.length > 0) searchFilters.fromEmail = fromEmails.join(',');

            const toMentions = buckets.to;
            if (toMentions.length > 0) searchFilters.toEmail = toMentions.map(m => m.id).join(',');

            if (withMentions.length > 0) {
              if (!options.isCallSearchPage) {
                searchFilters.type = VespaDocTypes.MESSAGES;
              }
              searchFilters.with = withMentions.map(user => user.id).join(',');
            }

            // with: / mention filters only apply to Messages - return empty for non-Messages tabs
            if (
              hasMessageOnlyMention &&
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

            // Bare @user → messages that mention the user (message-only filter).
            if (mentionUserMentions.length > 0) {
              searchFilters.type = VespaDocTypes.MESSAGES;
              searchFilters.mentions = mentionUserMentions.map(user => user.id).join(',');
            }

            // Explicit in:#channel scopes the search (cross-app); a bare #channel is a
            // channel-mention search over messages that reference the channel.
            if (inChannels.length > 0) {
              searchFilters.in = inChannels.map(m => m.id).join(',');
              // Explicit in: channels win — don't also constrain to "only my channels"
              // (else searching a channel you're not a member of returns nothing).
              searchFilters.onlyMyChannels = false;
            }
            if (mentionChannels.length > 0) {
              searchFilters.type = VespaDocTypes.MESSAGES;
              searchFilters.channelMentions = mentionChannels.map(m => m.id).join(',');
            }

            // Mention names are highlight-only — sent separately from `q` (the id filters handle
            // recall) so the backend can bold them without polluting the free-text query.
            const mentionHighlights = [...mentionUserMentions, ...mentionChannels]
              .map(m => m.name)
              .filter((n): n is string => !!n);
            if (mentionHighlights.length > 0) {
              searchFilters.mentionHighlights = mentionHighlights;
            }

            // Relevance of the active filters — computed once here and reused for
            // both the app narrowing below and the people-merge decision further down.
            const relevantTabs = getRelevantTabs(selectedMentions, query);

            // Narrow the queried apps to only those a filter can match, so ticket-only filters
            // (priority:/status:/…) stop scanning chat/file/mail that ignore them. ALL path only:
            // a specific tab self-scopes, and a canvas/transcript subApp override (above) wins.
            if (activeTab === TabType.ALL && !searchFilters.subApp) {
              const relevantAppsParam = getRelevantAppsParam(relevantTabs);
              if (relevantAppsParam) {
                searchFilters.apps = relevantAppsParam;
              }
            }

            let mergedResults: DisplaySearchResult[] = [];
            let totalCount = 0;
            let currentOffset = 0;
            let hasMore = false;

            if (activeTab === TabType.ALL) {
              const currentSessionId = searchSessionId || '';
              const vespaResponse = await searchService.vespaSearch(
                {
                  ...searchFilters,
                  //unified rank profile filters
                  ...(effectiveRankProfile === 'unified'
                    ? {
                        groupBy: '',
                        apps: `${VespaApps.CHAT},${VespaApps.TICKET},${VespaApps.FILE}`,
                      }
                    : options.groupByDocType && { groupBy: 'docType' }),
                  searchId: currentSessionId,
                  presentationSummary: 'lean',
                },
                abortController.signal,
                { cache: true },
              );

              // A newer search superseded this one — drop this out-of-order response.
              if (isStale()) return;

              // Honor the backend grouping decision: flat response => flat ALL view.
              setIsGrouped(vespaResponse.grouped);

              // Merge local people only when the active filters make the People category relevant.
              // from:/in:/assignee:/with:/@/# and non-people type: filters scope to content — people
              // are noise there. Same relevantTabs that gates the popup's People section.
              const peopleRelevant = !relevantTabs || relevantTabs.has(TabType.USERS);
              if (!peopleRelevant) {
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
              currentOffset = vespaResponse.results.length;
              // Paginate the ALL tab only in flat mode; grouped responses are capped
              // per docType and can't be offset-paginated.
              hasMore =
                !vespaResponse.grouped &&
                vespaResponse.results.length >= BACKEND_RESULTS_LIMIT &&
                currentOffset < vespaResponse.totalCount &&
                currentOffset + BACKEND_RESULTS_LIMIT <= MAX_BACKEND_OFFSET;
            } else {
              const currentSessionId = searchSessionId || '';
              const results = await searchService.vespaSearch(
                {
                  ...searchFilters,
                  searchId: currentSessionId,
                  presentationSummary: 'lean',
                },
                abortController.signal,
                { cache: true },
              );

              // A newer search superseded this one — drop this out-of-order response.
              if (isStale()) return;

              mergedResults = results.results;
              totalCount = results.totalCount;
              currentOffset = results.results.length;
              hasMore =
                results.results.length > 0 &&
                results.results.length >= BACKEND_RESULTS_LIMIT &&
                currentOffset < totalCount &&
                currentOffset + BACKEND_RESULTS_LIMIT <= MAX_BACKEND_OFFSET;
            }

            setSearchResults(mergedResults);
            latestResultsRef.current = mergedResults;
            latestQueryRef.current = searchText;

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
          }
        } catch (searchError) {
          // Ignore failures from a superseded/aborted request (e.g. axios CanceledError
          // when a newer search aborted this one) — they must not clear fresh results.
          if (!isStale()) {
            setSearchError(searchError instanceof Error ? searchError.message : 'Search failed');
            setSearchResults([]);
            // Reset to the default (sectioned) mode so a failed search doesn't render
            // stale results in the previous grouped/flat mode.
            setIsGrouped(true);
          }
        } finally {
          pendingSearchCountRef.current -= 1;
          // Only the latest run may flip the shared loading flag off.
          if (!isStale()) {
            setIsSearching(false);
          }
          // Fires once every dispatched search has settled — including when a
          // superseded run is the last to settle — so it must report the results
          // that were actually committed and the query they came from, not this
          // run's (possibly stale) searchText.
          if (
            pendingSearchCountRef.current === 0 &&
            latestResultsRef.current.length > 0 &&
            onComplete
          ) {
            onComplete(latestResultsRef.current, latestQueryRef.current);
          }
        }
      } else {
        resetSearchState();
      }
    },
    [
      searchSessionId,
      markSearchStart,
      resetSearchState,
      options.isCallSearchPage,
      includeBotMessages,
      onlyMyChannels,
      rankProfile,
      allDefaultRankProfile,
      includeDebugInfo,
      structuredFilters,
    ],
  );

  // Track the last effective search inputs to avoid duplicate calls.
  const lastSearchedParamsRef = useRef<{
    text: string;
    activeTab: TabType;
    mentionsKey: string;
    includeBotMessages: boolean;
    onlyMyChannels: boolean;
    rankProfile: string;
    allDefaultRankProfile: string;
    includeDebugInfo: boolean;
    structuredFiltersKey: string;
  }>({
    text: '',
    activeTab: TabType.ALL,
    mentionsKey: '',
    includeBotMessages: false,
    onlyMyChannels: options.defaultOnlyMyChannels ?? false,
    rankProfile: '',
    allDefaultRankProfile,
    includeDebugInfo: false,
    structuredFiltersKey: '{}',
  });

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

    // Skip if text, tab, mentions, and includeBotMessages are all the same as last search
    // This prevents unnecessary API calls when typing only spaces
    const currentMentionsKey = JSON.stringify(selectedMentions);
    if (
      normalizedText === lastSearchedParamsRef.current.text &&
      activeTab === lastSearchedParamsRef.current.activeTab &&
      includeBotMessages === lastSearchedParamsRef.current.includeBotMessages &&
      onlyMyChannels === lastSearchedParamsRef.current.onlyMyChannels &&
      currentMentionsKey === lastSearchedParamsRef.current.mentionsKey &&
      rankProfile === lastSearchedParamsRef.current.rankProfile &&
      allDefaultRankProfile === lastSearchedParamsRef.current.allDefaultRankProfile &&
      includeDebugInfo === lastSearchedParamsRef.current.includeDebugInfo &&
      structuredFiltersKey === lastSearchedParamsRef.current.structuredFiltersKey &&
      normalizedText !== ''
    ) {
      // Terminal exit with no dispatch — no performSearch().finally runs to disarm the loader.
      // Reconcile to the real in-flight state so a cancelled arm can't strand the spinner true.
      setIsSearchPending(pendingSearchCountRef.current > 0);
      return;
    }

    // Arm the loader now (before the 300ms debounce) so we never flash "No results"
    // in the gap before the request fires. Disarmed when the dispatched search settles.
    setIsSearchPending(true);
    const timer = setTimeout(() => {
      lastSearchedParamsRef.current = {
        text: normalizedText,
        activeTab,
        includeBotMessages,
        onlyMyChannels,
        rankProfile,
        allDefaultRankProfile,
        includeDebugInfo,
        structuredFiltersKey,
        mentionsKey: currentMentionsKey,
      };
      // Mint this dispatch's run identity here (not in the effect body) so the abort fires at
      // dispatch time, not on every keystroke; seq and the abort stay atomic together.
      const seq = ++searchSeqRef.current;
      searchAbortRef.current?.abort();
      const abortController = new AbortController();
      searchAbortRef.current = abortController;
      void performSearch(
        seq,
        abortController,
        text,
        activeTab,
        selectedMentions,
        filteredLocalUsers,
        filteredLocalChannels,
        options.onSearchComplete,
      ).finally(() => {
        // Runs on every exit path of performSearch (returns, errors, aborts). Only the
        // newest dispatch may clear the flag — a superseded run settling (aborted
        // mid-flight) must not hide the loader while a fresher search is still running.
        if (seq === searchSeqRef.current) {
          setIsSearchPending(false);
        }
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [
    text,
    activeTab,
    selectedMentions,
    filteredLocalUsers,
    filteredLocalChannels.length,
    options.onSearchComplete,
    options.mentionSearchType,
    performSearch,
    includeBotMessages,
    onlyMyChannels,
    rankProfile,
    allDefaultRankProfile,
    includeDebugInfo,
    structuredFiltersKey,
  ]);

  /**
   * Load More Results
   */
  const loadMoreResults = useCallback(async () => {
    const {
      searchText,
      board: boardFilter,
      tags: tagsFilter,
      before: beforeFilter,
      after: afterFilter,
      on: onFilter,
      range: rangeFilter,
      stage: stageFilter,
      status: statusFilter,
      type: typeFilter,
    } = resolveTextFilters(text, {
      ...structuredFilters,
      ...dateFiltersFromChips(selectedMentions),
      ...boardFilterFromChips(selectedMentions),
    });

    // Mirror performSearch: priority is chip-only (value from the chip, not text).
    const priorityFilter = selectedMentions.find(m => m.type === ChipType.PRIORITY)?.id;

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

    if (activeTab === TabType.USERS) return;
    setIsLoadingMore(true);

    try {
      {
        const currentOffset = currentPagination.offset;
        const pageSize = BACKEND_RESULTS_LIMIT;
        const effectiveRankProfile = rankProfile || allDefaultRankProfile;

        const searchFilters: VespaSearchFilters = {
          query: searchText,
          apps: `${VespaApps.CHAT},${VespaApps.TICKET},${VespaApps.FILE},${VespaApps.MAIL}`,
          // ALL-tab load-more only runs when the initial search was flat (grouped=false),
          // so force a flat continuation; without this the multi-app query re-groups.
          // Mail is left out for the same reason page 1 leaves it out.
          ...(activeTab === TabType.ALL && {
            groupBy: '',
            apps: `${VespaApps.CHAT},${VespaApps.TICKET},${VespaApps.FILE}`,
          }),
          offset: currentOffset,
          // Fixed-size window: constant limit, advancing offset (standard pagination).
          limit: pageSize,
          filterOnly: !searchText && !!hasFilters,
          includeBotMessages,
          onlyMyChannels,
          ...(effectiveRankProfile && { rankProfile: effectiveRankProfile }),
          ...(includeDebugInfo && { includeDebugInfo: true }),
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

        const buckets = deriveMentionBuckets(selectedMentions);
        const fromMentions = buckets.from;
        const withMentions = buckets.with;
        const assigneeMentions = buckets.assignee;
        const mentionUserMentions = buckets.mentions;
        const inChannels = buckets.in;
        const mentionChannels = buckets.channelMentions;
        // Bare @user/#channel filters only exist on chat messages. `with:` also
        // filters call participants on the Call History search page.
        const hasMessageOnlyMention =
          (!options.isCallSearchPage && withMentions.length > 0) ||
          mentionUserMentions.length > 0 ||
          mentionChannels.length > 0;

        // Assignee filter doesn't apply to Messages/Attachments - return empty
        if (
          assigneeMentions.length > 0 &&
          activeTab !== TabType.TICKETS &&
          activeTab !== TabType.ALL
        ) {
          setIsLoadingMore(false);
          return;
        }

        // with: / mention filters only apply to Messages - return empty for non-Messages tabs
        if (hasMessageOnlyMention && activeTab !== TabType.MESSAGES && activeTab !== TabType.ALL) {
          setIsLoadingMore(false);
          return;
        }

        // Handle type filter - only send backend-valid types (strip local types like users/people/channels)
        if (typeFilter) {
          const backendTypes = getBackendTypes(parseTypeFilter(typeFilter));
          if (backendTypes.length > 0) {
            searchFilters.type = backendTypes.join(',');
          }
        } else if (options.isCallSearchPage) {
          searchFilters.apps = VespaApps.CALL;
          searchFilters.type = VespaDocTypes.CALLS;
        } else if (activeTab === TabType.MESSAGES) {
          searchFilters.type = VespaDocTypes.MESSAGES;
        } else if (activeTab === TabType.ATTACHMENTS) {
          searchFilters.type = VespaDocTypes.FILES;
        } else if (activeTab === TabType.TICKETS) {
          searchFilters.type = VespaDocTypes.TICKETS;
        } else if (activeTab === TabType.DESK) {
          searchFilters.type = SearchableTypes.EMAILS;
          searchFilters.apps = VespaApps.MAIL;
        }

        // Add assignee filter for Tickets/ALL (force ticket-only search)
        if (assigneeMentions.length > 0) {
          searchFilters.type = VespaDocTypes.TICKETS;
          searchFilters.assignee = assigneeMentions.map(user => user.id).join(',');
        }

        const fromUserIdsMore = fromMentions.filter(m => !m.id.includes('@')).map(m => m.id);
        const fromEmailsMore = fromMentions.filter(m => m.id.includes('@')).map(m => m.id);
        if (fromUserIdsMore.length > 0) searchFilters.from = fromUserIdsMore.join(',');
        if (fromEmailsMore.length > 0) searchFilters.fromEmail = fromEmailsMore.join(',');

        const toMentionsMore = buckets.to;
        if (toMentionsMore.length > 0)
          searchFilters.toEmail = toMentionsMore.map(m => m.id).join(',');

        if (withMentions.length > 0) {
          if (!options.isCallSearchPage) {
            searchFilters.type = VespaDocTypes.MESSAGES;
          }
          searchFilters.with = withMentions.map(user => user.id).join(',');
        }

        // Bare @user → messages that mention the user (message-only filter).
        if (mentionUserMentions.length > 0) {
          searchFilters.type = VespaDocTypes.MESSAGES;
          searchFilters.mentions = mentionUserMentions.map(user => user.id).join(',');
        }

        // Explicit in:#channel scopes (cross-app); a bare #channel is a channel-mention search.
        if (inChannels.length > 0) {
          searchFilters.in = inChannels.map(m => m.id).join(',');
          // Explicit in: channels win over "only my channels" (keep parity with the initial search).
          searchFilters.onlyMyChannels = false;
        }
        if (mentionChannels.length > 0) {
          searchFilters.type = VespaDocTypes.MESSAGES;
          searchFilters.channelMentions = mentionChannels.map(m => m.id).join(',');
        }

        // Highlight-only mention names — mirrors the initial search (see note there).
        const mentionHighlights = [...mentionUserMentions, ...mentionChannels]
          .map(m => m.name)
          .filter((n): n is string => !!n);
        if (mentionHighlights.length > 0) {
          searchFilters.mentionHighlights = mentionHighlights;
        }

        const currentSessionId = searchSessionId || '';
        const results = await searchService.vespaSearch({
          ...searchFilters,
          searchId: currentSessionId,
          presentationSummary: 'lean',
        });
        setSearchResults(prev => [...prev, ...results.results]);

        const newOffset = currentOffset + results.results.length;
        const hasMore =
          results.results.length > 0 &&
          results.results.length >= BACKEND_RESULTS_LIMIT &&
          newOffset < results.totalCount &&
          // Stop before the next page's offset would exceed Vespa's maxOffset.
          newOffset + BACKEND_RESULTS_LIMIT <= MAX_BACKEND_OFFSET;

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
      }
    } catch (searchError) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Failed to load more results:'),
        error: searchError,
      });
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
    includeBotMessages,
    onlyMyChannels,
    rankProfile,
    allDefaultRankProfile,
    includeDebugInfo,
    structuredFilters,
    options.isCallSearchPage,
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
    includeBotMessages,
    setIncludeBotMessages,
    onlyMyChannels,
    setOnlyMyChannels,
    rankProfile,
    setRankProfile,
    structuredFilters,
    setStructuredFilters,
    includeDebugInfo,
    setIncludeDebugInfo,
    loadMore,
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
    isGrouped,
    isSearching,
    isSearchPending,
    searchError,
    isLoadingMore,
    paginationState,
    resetSearchState,
  };
}
