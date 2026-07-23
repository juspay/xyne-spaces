import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Fuse from 'fuse.js';
import { searchMetricsService } from '../services/searchMetricsService';
import { useAuthContextValues } from './useAuth';
import { searchService } from '../services/searchService';
import { DisplaySearchResult, VespaSearchFilters } from '../types/search';
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
import { searchChannelsWithScores } from './useChannels';
import { ChannelCategory } from '../components/Chat/ChatDirectory/ChatDirectory.types';
import { isDMChannel } from '../components/Chat/ChatDirectory/ChatDirectory.utils';
import { isUserDeactivated } from '../utils/userDisplayName';
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

// Squashes raw affinity into [0, 1] with diminishing returns.
// At affinity=50 → sat=0.5; at affinity=200 → sat≈0.9.
const sat = (x: number): number => (2 / Math.PI) * Math.atan(x / 50);

// Fuse instances are expensive to construct — cache by searchableNames content
// so the same instance is reused across keystrokes for the same DM channel.
// Bounded LRU: evict oldest entry when the map grows beyond MAX_FUSE_CACHE_SIZE.
const MAX_FUSE_CACHE_SIZE = 50;
const fuseCache = new Map<string, Fuse<string>>();
function getFuseInstance(searchableNames: string[]): Fuse<string> {
  const key = searchableNames.join('\0');
  let instance = fuseCache.get(key);
  if (!instance) {
    if (fuseCache.size >= MAX_FUSE_CACHE_SIZE) {
      fuseCache.delete(fuseCache.keys().next().value!);
    }
    instance = new Fuse(searchableNames, {
      threshold: 0.35,
      includeScore: true,
      ignoreLocation: true,
      minMatchCharLength: 1,
    });
    fuseCache.set(key, instance);
  }
  return instance;
}

// Affinity weight for DM ranking. Fuse scores are [0, 1]; 0.5 means peak
// affinity shifts a result by half the score range.
const AFFINITY_WEIGHT = 0.5;

// Affinity weight for regular channel ranking. searchChannelsWithScores
// applies −10/−5 prefix boosts, so the score range is ~[−10, 0.3].
// At W=10, sat(affinity)×10 equals the 5-point tier gap when affinity
// hits the sat() midpoint (50), so regularly-used channels (affinity≥50)
// can surface above a lower-affinity prefix match. Fuzzy matches need
// affinity≫1000 to cross the 10-point prefix gap — effectively never.
const REGULAR_CHANNEL_AFFINITY_WEIGHT = 10;

type SearchTrigger = 'keyboard_shortcut' | 'click' | 'auto_focus';
type SearchLocation = 'global' | 'channel' | 'dm';
type QuerySource = 'KEYBOARD' | 'CLIPBOARD_PASTE';

type SelectedMention = { id: string; type: MentionType; prefix?: string; name?: string };

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
 * Split selected chips into search buckets: a bare (prefix-less) @user/#channel is a *mention*
 * search; explicit from:/with:/assignee:/in: keep their meaning. Shared by all 3 fold-sites.
 */
function deriveMentionBuckets(selectedMentions: SelectedMention[]): MentionBuckets {
  const users = selectedMentions.filter(m => m.type === MentionType.USER);
  const channels = selectedMentions.filter(m => m.type === MentionType.CHANNEL);
  return {
    from: users.filter(m => m.prefix === 'from:'),
    with: users.filter(m => m.prefix === 'with:'),
    assignee: users.filter(m => m.prefix === 'assignee:'),
    // to:@user is an email-recipient filter (→ toEmail), not a mention search.
    to: users.filter(m => m.prefix === 'to:'),
    // Bare @user (no prefix) is a mention search, not an author filter.
    mentions: users.filter(m => !m.prefix),
    in: channels.filter(m => m.prefix === 'in:'),
    // Bare #channel (no prefix) is a channel-mention search, not a scope.
    channelMentions: channels.filter(m => !m.prefix),
  };
}

interface UseSearchMetricsOptions {
  searchLocation?: SearchLocation;
  allChannels?: Array<{ channel: Channel; category: ChannelCategory; searchableNames?: string[] }>;
  onSearchComplete?: (results: DisplaySearchResult[], query: string) => void;
  mentionSearchType?: MentionType | null;
  isCallSearchPage?: boolean;
  // Initial value for the "Include my channels" toggle. Defaults to false so the
  // full-page search is unaffected; the Cmd-K modal opts in with `true`.
  defaultOnlyMyChannels?: boolean;
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
 * Rank Cmd+K user candidates:
 *   1. name-prefix matches first
 *   2. within a tier, active before deactivated (soft, not a global demotion)
 *   3. DM-contact users within each tier
 *   4. tie-break by DM recency (smaller index = more recent activity), so
 *      `from:` with no text shows the same people-you-talk-to-most order
 *      that the plain-search empty state shows in the DIRECT MESSAGES
 *      section.
 *
 * `dmContactRecency` maps a user ID to its position in the recency-ordered
 * 1:1 DM list (0 = most recent). Users not in the map fall through to the
 * incoming alphabetical order from `searchUsers`.
 */
export function rankUsers<T extends { id: string; name: string; status?: string | null }>(
  users: T[],
  query: string,
  dmContactRecency: Map<string, number>,
): T[] {
  const q = query.toLowerCase().trim();
  const isPrefixMatch = (name: string): boolean => !!q && name.toLowerCase().startsWith(q);

  // Stable sort (ES2019+) preserves the incoming `searchUsers` order
  // (alphabetical for non-DM users) when all keys tie.
  return [...users].sort((a, b) => {
    // 1. name-prefix matches (the relevance signal) first
    const aPrefix = isPrefixMatch(a.name);
    const bPrefix = isPrefixMatch(b.name);
    if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;

    // 2. within a tier, active before deactivated. Soft/per-tier: key 1 already
    //    let a relevant deactivated user beat a slightly-relevant active one.
    const aDeactivated = isUserDeactivated(a);
    const bDeactivated = isUserDeactivated(b);
    if (aDeactivated !== bDeactivated) return aDeactivated ? 1 : -1;

    // 3. DM contacts before non-contacts, but only after activation
    const aDM = dmContactRecency.has(a.id);
    const bDM = dmContactRecency.has(b.id);
    if (aDM !== bDM) return aDM ? -1 : 1;

    // 4. more-recent DM first (0 = most recent)
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

  const matchedDms = dmItems
    .flatMap(item => {
      const { searchableNames } = item;
      if (!searchableNames || searchableNames.length === 0 || queryParts.length === 0) return [];

      const fuse = getFuseInstance(searchableNames);

      let totalFuseScore = 0;
      for (const part of queryParts) {
        const results = fuse.search(part);
        if (results.length === 0) return []; // AND: every token must match some participant
        const best = results[0]!;
        const score = best.score ?? 1;
        const matched = best.item.toLowerCase();
        totalFuseScore += matched.startsWith(part) ? score - 0.5 : score;
      }

      // Fuse scores are [0, 1] (0 = perfect). Prefix boost subtracts 0.5, making
      // per-part scores potentially negative. Subtraction (not division) is critical:
      // division would make negative scores less negative with high affinity, inverting
      // the ranking. Lower finalScore = better rank.
      const fuseScore = totalFuseScore / queryParts.length;
      const affinity = affinityService.getChannelWeight(item.channel.id);
      const finalScore = fuseScore - sat(affinity) * AFFINITY_WEIGHT;

      return [{ item, score: finalScore }];
    })
    .sort((a, b) => a.score - b.score) // lower = better
    .map(({ item }) => item);

  const regularChannels = regularItems.map(item => item.channel);
  const regularItemsById = new Map(regularItems.map(item => [item.channel.id, item]));

  // searchChannelsWithScores runs the same Fuse fuzzy match + prefix boosts
  // as searchChannels but returns { item, score }[] instead of just items,
  // so we can apply affinity on top before deciding the final order.
  const matchedRegular = searchChannelsWithScores(regularChannels, query, regularChannels.length)
    .flatMap(({ item: channel, score }) => {
      const item = regularItemsById.get(channel.id);
      if (!item) return [];

      const affinity = affinityService.getChannelWeight(channel.id);
      const finalScore = score - sat(affinity) * REGULAR_CHANNEL_AFFINITY_WEIGHT;

      return [{ item, score: finalScore }];
    })
    .sort((a, b) => a.score - b.score)
    .map(({ item }) => item);

  return [...matchedDms, ...matchedRegular];
}

export function useSearchMetrics(options: UseSearchMetricsOptions = {}) {
  const context = useAuthContextValues();

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
  const [selectedMentions, setSelectedMentions] = useState<
    Array<{ id: string; type: MentionType; prefix?: string; name?: string }>
  >([]);
  // Cmd-K "Include bot messages" toggle. Default OFF → backend excludes BOT messages.
  const [includeBotMessages, setIncludeBotMessages] = useState(false);
  // Cmd-K "Include my channels" toggle. Modal opts in via `defaultOnlyMyChannels`;
  // other consumers (full-page search) default OFF so their behavior is unchanged.
  const [onlyMyChannels, setOnlyMyChannels] = useState(options.defaultOnlyMyChannels ?? false);
  // Vespa rank profile, passed through to the search payload. '' => backend default.
  const [rankProfile, setRankProfile] = useState('');
  // Compare mode: request per-result matchfeatures/rankfeatures for ranking debug.
  const [includeDebugInfo, setIncludeDebugInfo] = useState(false);
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
  // Whether the ALL-tab results should render as per-docType sections. Mirrors the
  // backend's `grouped` flag (true when Vespa grouped by docType, false for a flat
  // ranked list). Defaults true to preserve the sectioned ALL view.
  const [isGrouped, setIsGrouped] = useState(true);
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

      // Priority is chip-only — track it from the chip, not parsed text.
      if (selectedMentions.some(m => m.type === MentionType.PRIORITY)) {
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
  }, [resetImpressionTracking]);

  /**
   * Perform Search
   */
  const performSearch = useCallback(
    async (
      query: string,
      activeTab: TabType,
      selectedMentions: Array<{ id: string; type: MentionType; prefix?: string; name?: string }>,
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

      // Priority is chip-only: value comes solely from the chip; raw `priority:` text
      // isn't a filter (falls through to full-text search).
      const priorityFilter = selectedMentions.find(m => m.type === MentionType.PRIORITY)?.id;

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
            const searchFilters: VespaSearchFilters = {
              query: searchText,
              apps: apps,
              offset: 0,
              limit: limit,
              filterOnly: !searchText && !!hasFilters,
              includeBotMessages,
              onlyMyChannels,
              ...(rankProfile && { rankProfile }),
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

            let mergedResults: DisplaySearchResult[] = [];
            let totalCount = 0;
            let currentOffset = 0;
            let hasMore = false;

            if (activeTab === TabType.ALL) {
              const currentSessionId = searchSessionId || '';
              const vespaResponse = await searchService.vespaSearch({
                ...searchFilters,
                // The `unified` profile normalizes every schema's score into the same
                // 0-1 range, so its hits are directly comparable across doc types.
                // Grouping would bucket that single global ranking back into per-type
                // lists (<=10 each), so opt out with an explicit empty groupBy — the
                // backend falls back to 'docType' when the param is absent entirely.
                ...(rankProfile === 'unified'
                  ? { groupBy: '' }
                  : options.groupByDocType && { groupBy: 'docType' }),
                searchId: currentSessionId,
                presentationSummary: 'lean',
              });

              // Honor the backend grouping decision: flat response => flat ALL view.
              setIsGrouped(vespaResponse.grouped);

              // Merge local users only when no type filter AND no message-only mention is active
              // (a bare @user/#channel filter is message-only, so people shouldn't be merged in).
              if (typeFilter || hasMessageOnlyMention) {
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
              const results = await searchService.vespaSearch({
                ...searchFilters,
                searchId: currentSessionId,
                presentationSummary: 'lean',
              });
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
          setSearchError(searchError instanceof Error ? searchError.message : 'Search failed');
          setSearchResults([]);
          // Reset to the default (sectioned) mode so a failed search doesn't render
          // stale results in the previous grouped/flat mode.
          setIsGrouped(true);
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
    [
      searchSessionId,
      markSearchStart,
      resetSearchState,
      options.isCallSearchPage,
      includeBotMessages,
      onlyMyChannels,
      rankProfile,
      includeDebugInfo,
    ],
  );

  // Track the last search text, tab, mentions, includeBotMessages, and rankProfile to avoid duplicate calls
  const lastSearchedParamsRef = useRef<{
    text: string;
    activeTab: TabType;
    mentionsKey: string;
    includeBotMessages: boolean;
    onlyMyChannels: boolean;
    rankProfile: string;
    includeDebugInfo: boolean;
  }>({
    text: '',
    activeTab: TabType.ALL,
    mentionsKey: '',
    includeBotMessages: false,
    onlyMyChannels: options.defaultOnlyMyChannels ?? false,
    rankProfile: '',
    includeDebugInfo: false,
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
      includeDebugInfo === lastSearchedParamsRef.current.includeDebugInfo &&
      normalizedText !== ''
    ) {
      return;
    }

    const timer = setTimeout(() => {
      lastSearchedParamsRef.current = {
        text: normalizedText,
        activeTab,
        includeBotMessages,
        onlyMyChannels,
        rankProfile,
        includeDebugInfo,
        mentionsKey: currentMentionsKey,
      };
      void performSearch(
        text,
        activeTab,
        selectedMentions,
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
    filteredLocalUsers,
    filteredLocalChannels.length,
    options.onSearchComplete,
    options.mentionSearchType,
    performSearch,
    includeBotMessages,
    onlyMyChannels,
    rankProfile,
    includeDebugInfo,
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
    } = parseSearchFilters(text);

    // Mirror performSearch: priority is chip-only (value from the chip, not text).
    const priorityFilter = selectedMentions.find(m => m.type === MentionType.PRIORITY)?.id;

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

        const searchFilters: VespaSearchFilters = {
          query: searchText,
          apps: `${VespaApps.CHAT},${VespaApps.TICKET},${VespaApps.FILE},${VespaApps.MAIL}`,
          // ALL-tab load-more only runs when the initial search was flat (grouped=false),
          // so force a flat continuation; without this the multi-app query re-groups.
          ...(activeTab === TabType.ALL && { groupBy: '' }),
          offset: currentOffset,
          // Fixed-size window: constant limit, advancing offset (standard pagination).
          limit: pageSize,
          filterOnly: !searchText && !!hasFilters,
          includeBotMessages,
          onlyMyChannels,
          ...(rankProfile && { rankProfile }),
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
    includeBotMessages,
    onlyMyChannels,
    rankProfile,
    includeDebugInfo,
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
    searchError,
    isLoadingMore,
    paginationState,
    resetSearchState,
  };
}
