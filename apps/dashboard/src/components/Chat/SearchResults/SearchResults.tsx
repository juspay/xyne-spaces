import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from '@xyne/icons';
import { ResizableGroup, Panel, Separator } from '../../ui/Resizable/Resizable';
import {
  FileText,
  GitCompare,
  Hash,
  Loader2,
  Mail,
  MessageCircle,
  Mic,
  Paperclip,
  X,
} from 'lucide-react';

const utcToIst = (utcString?: string): string => {
  // The backend writes the literal 'N/A' when a doc has no usable timestamp, so
  // treat it as absent — otherwise it parses to an Invalid Date and every card
  // that doesn't pre-guard renders the string "Invalid Date".
  if (!utcString || utcString === 'N/A') return '';
  const dateUtc = new Date(`${utcString} UTC`);
  return dateUtc.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};
import ThreadMessages from '../ThreadPannel';
import { UserProfile } from '../../ui/UserProfile/UserProfile';
import { usePlatform } from '../../../hooks/usePlatform';
import { useAuth, useAuthContextValues } from '../../../hooks/useAuth';
import {
  DEFAULT_SEARCH_FILTERS,
  saveLastSearchState,
  type SearchResultsFilters,
} from '../../../hooks/useSearchResultsScreen';
import {
  ALL_FILTER_PARAM_KEYS,
  buildChips,
  buildSearchFilters,
  buildTokens,
  readFiltersFromParams,
  writeFiltersToParams as writeRegistryParams,
  type FilterResolvers,
} from '../../../search/filterRegistry';
import { DisplaySearchResult } from '../../../types/search';
import { SearchResultMessageCard } from './SearchResultMessageCard';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import { SearchSnippetRenderer } from '../RenderMessageWithHTML/searchSnippetRender';
import { SearchResultsContext, SearchResultsThread } from './SearchResultsContext';
import { SearchFilterBar } from './SearchFilterBar';
import { SearchQueryInput, type QueryToken } from './SearchQueryInput';
import { parseSearchFilters } from '../../../utils/searchFilterParser';
import {
  useAllVisibleChannels,
  useAllChannels,
  useUserChannelStatuses,
} from '../../../hooks/useChannels';
import ConversationPanelV2 from '../ConversationPannel/ConversationPanelV2';
import { useSearchMetrics } from '../../../hooks/useSearchMetrics';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { useUser, useUsers } from '../../../hooks/useUsers';
import {
  getDMNames,
  isDMChannel,
  isGroupDMChannel,
  groupChannelsByScope,
  resolveChannelLabel,
} from '../ChatDirectory/ChatDirectory.utils';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { formatFileSize } from '../MessageAttachment/utils';
import {
  TabType,
  VALID_DOC_TYPES,
  DOC_TYPE_TO_TAB,
} from '../ChatDirectory/ChannelCommandMenu.types';
import { ChannelCategory } from '../ChatDirectory/ChatDirectory.types';
import { Channel } from '@xyne/shared';
import { navigateToSearchResult } from '../../../utils/searchNavigation';
import Avatar from '../../ui/Avatar/Avatar';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../../../utils/classNames';
import { CompareSelectRow } from './compare/CompareSelectRow';
import { SearchCompareDialog } from './compare/SearchCompareDialog';
import { hasRankingData } from './compare/rankingFeatures';
import {
  TicketSearchHighlightContext,
  type TicketSearchHighlight,
} from '../../Tickets/TicketCard/TicketCard';
import {
  TicketPriority,
  TicketStatusV2,
  MessageType,
  isDeskChannelType,
  serializeTicketMd,
} from '@xyne/shared';
import { TicketCardV2 } from '../../Tickets/TicketCardV2/TicketCardV2';
import { isUserDeactivated } from '../../../utils/userDisplayName';

type SidePanelState =
  | { kind: 'thread'; thread: SearchResultsThread }
  | { kind: 'profile'; userId: string }
  | {
      kind: 'channel';
      channelId: string;
      conversationId: string;
      conversationCreatedAt?: number;
      matchedMessageId?: string | null;
    }
  | null;

function parseDocTypeParam(value: string | null): SearchResultsFilters['docType'] | null {
  return value && (VALID_DOC_TYPES as string[]).includes(value)
    ? (value as SearchResultsFilters['docType'])
    : null;
}

function docTypeToTabType(docType: SearchResultsFilters['docType']): TabType {
  return DOC_TYPE_TO_TAB[docType] ?? TabType.ALL;
}

// Returns true when any sender/channel/assignee/participant filter is active.
// Centralised here so adding a new filter type only requires one update.
function hasActiveFilters(
  filters: Pick<
    SearchResultsFilters,
    'fromUserIds' | 'inChannelIds' | 'assigneeIds' | 'withUserIds'
  >,
): boolean {
  return (
    filters.fromUserIds.length > 0 ||
    filters.inChannelIds.length > 0 ||
    filters.assigneeIds.length > 0 ||
    filters.withUserIds.length > 0
  );
}

function toMessageType(value?: string): MessageType {
  return (Object.values(MessageType) as string[]).includes(value ?? '')
    ? (value as MessageType)
    : MessageType.USER;
}

/**
 * URL ⇄ filter-bar state. The palette hands the page its whole search through these params,
 * and every bar/popover change is written back, so a results URL is a complete, shareable
 * description of the search (UX-5). `query` and `display` are owned by the header input and
 * handled separately.
 */
const SORT_VALUES: ReadonlyArray<SearchResultsFilters['sortBy']> = [
  'relevance',
  'newest',
  'oldest',
];

function parseFiltersFromParams(
  params: URLSearchParams,
  previous: SearchResultsFilters = DEFAULT_SEARCH_FILTERS,
): SearchResultsFilters {
  const tabParam = parseDocTypeParam(params.get('tab'));
  const sortParam = params.get('sort') as SearchResultsFilters['sortBy'] | null;
  // Filter syntax can also arrive typed into the query (`status:todo` from the palette,
  // which has no control for it); each registry entry decides how its params and that
  // text merge.
  const typed = parseSearchFilters(params.get('query') ?? '');
  return {
    ...previous,
    // Only the palette and the "See N more" links pass a tab; absent it, keep the user's
    // current tab so unrelated URL changes don't reset it.
    ...(tabParam ? { docType: tabParam } : {}),
    ...readFiltersFromParams(params, typed),
    sortBy:
      sortParam && SORT_VALUES.includes(sortParam) ? sortParam : DEFAULT_SEARCH_FILTERS.sortBy,
    rankProfile: params.get('rank') ?? '',
  };
}

/** Order-independent fingerprint of the filter params, for comparing URL against state. */
function serializeFilterParams(params: URLSearchParams): string {
  const filtered = new URLSearchParams();
  for (const key of ALL_FILTER_PARAM_KEYS) {
    const value = params.get(key);
    if (value) filtered.set(key, value);
  }
  filtered.sort();
  return filtered.toString();
}

/** filters → URL: the registry's params, plus the page-level ones it doesn't own. */
function writeFiltersToParams(filters: SearchResultsFilters, params: URLSearchParams): void {
  writeRegistryParams(filters, params);
  if (filters.docType === 'all') params.delete('tab');
  else params.set('tab', filters.docType);
  if (filters.sortBy === DEFAULT_SEARCH_FILTERS.sortBy) params.delete('sort');
  else params.set('sort', filters.sortBy);
  if (filters.rankProfile) params.set('rank', filters.rankProfile);
  else params.delete('rank');
}

const SearchResults = (): ReactElement => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isMobile } = usePlatform();
  const [selectedPanel, setSelectedPanel] = useState<SidePanelState>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const query = searchParams.get('query')?.trim() ?? '';

  const [filters, setFilters] = useState<SearchResultsFilters>(() =>
    parseFiltersFromParams(searchParams),
  );

  // —— Compare mode (ranking comparison) ——
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<DisplaySearchResult[]>([]);
  const [relevantIds, setRelevantIds] = useState<Set<string>>(() => new Set());
  const [compareOpen, setCompareOpen] = useState(false);
  const selectedIds = useMemo(() => new Set(selected.map(r => r.id)), [selected]);

  const toggleSelect = useCallback((r: DisplaySearchResult) => {
    setSelected(prev =>
      prev.some(s => s.id === r.id) ? prev.filter(s => s.id !== r.id) : [...prev, r],
    );
  }, []);
  const removeFromCompare = useCallback((id: string) => {
    setSelected(prev => prev.filter(s => s.id !== id));
  }, []);
  const toggleRelevant = useCallback((id: string) => {
    setRelevantIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => {
    setSelected([]);
    setRelevantIds(() => new Set());
  }, []);
  const closeCompare = useCallback(() => setCompareOpen(false), []);

  // Local channel + user data — needed before useSearchMetrics so allChannels can be passed in
  const isChannelsMode = filters.docType === 'channels';
  const allChannels = useAllVisibleChannels();
  const allChannelsForNav = useAllChannels();
  const allUsers = useUsers();
  const authContext = useAuthContextValues();
  const currentUserId = authContext.userID;

  const usersById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);

  // Partition channels into starred / regular / DMs — mirrors cmdK's allChannels build exactly.
  const allChannelStatuses = useUserChannelStatuses();
  const {
    starred: starredChannels,
    channels: regularChannels,
    directMessages: dmChannels,
  } = useMemo(
    () => groupChannelsByScope(allChannels, allChannelStatuses),
    [allChannels, allChannelStatuses],
  );

  const allChannelsWithCategory = useMemo((): Array<{
    channel: Channel;
    category: ChannelCategory;
    searchableNames?: string[];
    searchNames?: string[];
  }> => {
    const result = [];
    for (const ch of starredChannels) {
      const dmNames = getDMNames(ch, currentUserId, usersById);
      result.push({
        channel: ch,
        category: ChannelCategory.STARRED,
        searchableNames: dmNames.display,
        searchNames: dmNames.search,
      });
    }
    for (const ch of regularChannels) {
      result.push({ channel: ch, category: ChannelCategory.CHANNELS, searchableNames: [ch.name] });
    }
    for (const ch of dmChannels) {
      const dmNames = getDMNames(ch, currentUserId, usersById);
      result.push({
        channel: ch,
        category: ChannelCategory.DIRECT_MESSAGES,
        searchableNames: dmNames.display,
        searchNames: dmNames.search,
      });
    }
    return result;
  }, [starredChannels, regularChannels, dmChannels, currentUserId, usersById]);

  // Use the exact same hook as the popup modal — no separate search infrastructure
  const {
    searchResults: backendResults,
    isGrouped,
    isSearching: isLoading,
    isSearchPending,
    searchError: error,
    text: searchedText,
    setText,
    setActiveTab,
    setSelectedMentions,
    setIncludeBotMessages,
    setOnlyMyChannels,
    setExactMatch,
    setRankProfile,
    setStructuredFilters,
    setIncludeDebugInfo,
    loadMoreRef,
    paginationState,
    filteredLocalUsers,
    filteredLocalChannels,
  } = useSearchMetrics({
    allChannels: allChannelsWithCategory,
    mentionSearchType: null,
    defaultOnlyMyChannels: filters.onlyMyChannels,
    groupByDocType: true,
  });

  // The text the on-screen results actually reflect. Results update live as the user
  // types (the hook searches `searchedText`) but the URL `query` only commits on Enter,
  // so query-driven UI (empty-state copy, local-section gating) must read this, not the
  // stale URL param. Falls back to `query` on first paint before the sync effect runs.
  const displayQuery = searchedText.trim() || query;

  // Sync hook text whenever the URL query param changes; also close sidebar on new search
  useEffect(() => {
    setText(query);
    setSelectedPanel(null);
    setSelected([]);
    setRelevantIds(() => new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // URL filter params → filter state. Covers the palette handoff into an already-mounted
  // page, the "See N more" links, back/forward, and a pasted results URL.
  const urlFilterKey = useMemo(() => serializeFilterParams(searchParams), [searchParams]);
  useEffect(() => {
    setFilters(prev => parseFiltersFromParams(new URLSearchParams(urlFilterKey), prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlFilterKey]);

  // Park the live search where the palette can find it. Its own history entry froze the
  // moment we navigated here, so without this a back-navigation restores the search as it
  // was before any filter set on this page.
  useEffect(() => {
    saveLastSearchState(searchParams.toString());
  }, [searchParams]);

  // Sync docType filter → hook active tab.
  // When from: is active with "all" tab, the Vespa from: filter is message-schema-only,
  // so restrict the hook to messages to get results. The UI still shows "All types".
  useEffect(() => {
    if (filters.docType !== 'channels') {
      const effectiveTab =
        filters.docType === 'all' && filters.fromUserIds.length > 0
          ? TabType.MESSAGES
          : docTypeToTabType(filters.docType);
      setActiveTab(effectiveTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.docType, filters.fromUserIds]);

  // Sync includeBotMessages filter → hook
  useEffect(() => {
    setIncludeBotMessages(filters.includeBotMessages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.includeBotMessages]);

  // Sync "only my channels" filter → hook (applied server-side via the onlyMyChannels flag)
  useEffect(() => {
    setOnlyMyChannels(filters.onlyMyChannels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.onlyMyChannels]);

  // Sync exact-match → hook; the hook quotes the query when the request is built.
  useEffect(() => {
    setExactMatch(filters.exactMatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.exactMatch]);

  // Sync rankProfile filter → hook; clear selection so the matrix never mixes
  // ranking data captured under different profiles
  useEffect(() => {
    setRankProfile(filters.rankProfile);
    setSelected([]);
    setRelevantIds(() => new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.rankProfile]);

  // Compare mode → request ranking debug info; clear selection when leaving.
  useEffect(() => {
    setIncludeDebugInfo(compareMode);
    if (!compareMode) {
      setSelected([]);
      setRelevantIds(() => new Set());
      setCompareOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode]);

  // Sync the popover's ticket/date filters → hook. They ride the same backend fields as the
  // typed `status:`/`board:`/`tags:`/`before:` syntax, which keeps working alongside them.
  const structuredFilters = useMemo(() => buildSearchFilters(filters), [filters]);
  const structuredFiltersKey = JSON.stringify(structuredFilters);
  useEffect(() => {
    setStructuredFilters(structuredFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuredFiltersKey]);

  // Only explicit in: chips are passed as channel mentions; "only my channels" is
  // applied server-side via the onlyMyChannels flag synced above.
  const channelIdsForSearch = filters.inChannelIds;

  // Resolve a mention id → display name for the highlight phrase (the URL carries only ids).
  const mentionUserName = useCallback(
    (id: string): string | undefined => {
      const user = allUsers.find(u => u.id === id);
      return user ? getUserDisplayName(user) : undefined;
    },
    [allUsers],
  );
  // Falls back to every known channel: a carried-over `in:` may point at a DM or a channel
  // the user has left, neither of which is in the *visible* set.
  const mentionChannelName = useCallback(
    (id: string): string | undefined => {
      const channel =
        allChannels.find(c => c.id === id) ?? allChannelsForNav.find(c => c.id === id);
      // A DM's `name` is its participant ids comma-joined, so it can't be shown raw.
      return channel ? resolveChannelLabel(channel, currentUserId ?? '', allUsers) : undefined;
    },
    [allChannels, allChannelsForNav, currentUserId, allUsers],
  );
  // Id → name for every registry entry that renders one.
  // Board tokens carry the board id (that's what the backend matches on), so they need a
  // resolver too or they render as a raw cuid.
  const [allBoardsList] = useCachedQuery(queries.getAllBoardsList());
  const boardName = useCallback(
    (id: string): string | undefined =>
      (allBoardsList as ReadonlyArray<{ id: string; name: string }> | undefined)?.find(
        b => b.id === id,
      )?.name,
    [allBoardsList],
  );
  const filterResolvers = useMemo(
    (): FilterResolvers => ({
      userName: mentionUserName,
      channelName: mentionChannelName,
      boardName,
    }),
    [mentionUserName, mentionChannelName, boardName],
  );

  // Sync every chip filter (from/to/with/in/assignee/priority + bare @/#) → hook mentions
  useEffect(() => {
    setSelectedMentions(
      buildChips({ ...filters, inChannelIds: channelIdsForSearch }, filterResolvers),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.fromUserIds,
    filters.fromEmails,
    filters.toEmails,
    channelIdsForSearch,
    filters.assigneeIds,
    filters.withUserIds,
    filters.mentionUserIds,
    filters.mentionChannelIds,
    filters.priority,
    mentionUserName,
    mentionChannelName,
  ]);

  // Declared above the memo that uses it, so the callback is reached through a ref.
  const handleFiltersChangeRef = useRef<(next: SearchResultsFilters) => void>(() => undefined);

  /**
   * Applied filters as search-box tokens, labelled with the syntax that expresses them, so
   * the box reads as the whole search — `from:@nasim in:#access-requests issue` — instead
   * of only its free-text half. Removing one re-runs the search without it.
   */
  /**
   * Applied filters as search-box tokens. Labels and removal both come from the registry,
   * so a new filter shows up here without touching this component.
   */
  const queryTokens = useMemo(
    (): QueryToken[] =>
      buildTokens(filters, filterResolvers).map(token => ({
        key: token.key,
        ...(token.prefix ? { prefix: token.prefix } : {}),
        ...(token.chip ? { chip: token.chip } : {}),
        label: token.label,
        onRemove: () => handleFiltersChangeRef.current({ ...filters, ...token.patch }),
        ...(token.icon ? { icon: token.icon } : {}),
      })),
    [filters, filterResolvers],
  );

  // Keep `display` — the label the global top bar shows — in step with the filters. It's
  // written once by the palette at hand-off, so without this the bar keeps showing the
  // search as it was launched and never reflects anything filtered here.
  const displayLabel = useMemo(
    // Prefix + value, so the top bar still reads `in:general`, not a bare `general`.
    () => [...queryTokens.map(t => `${t.prefix ?? ''}${t.label}`), query].filter(Boolean).join(' '),
    [queryTokens, query],
  );
  /**
   * The complete URL this page's state implies: filter params, the query with any filter
   * syntax lifted out of it, and the `display` label.
   *
   * Built and written as ONE update on purpose. Splitting it across several effects loses
   * writes — each `setSearchParams(prev => …)` in the same commit sees the pre-update
   * params, so the last one silently drops what the others just wrote.
   */
  const desiredSearch = useMemo(() => {
    const params = new URLSearchParams(searchParams);
    writeFiltersToParams(filters, params);
    // Filter syntax in the query has been lifted into `filters` by parseFiltersFromParams;
    // strip it so it isn't shown twice — once as its token, once as raw words.
    const cleanedQuery = parseSearchFilters(params.get('query') ?? '').searchText;
    if (cleanedQuery) params.set('query', cleanedQuery);
    else params.delete('query');
    if (displayLabel) params.set('display', displayLabel);
    else params.delete('display');
    return params.toString();
  }, [searchParams, filters, displayLabel]);

  useEffect(() => {
    if (desiredSearch === searchParams.toString()) return;
    setSearchParams(new URLSearchParams(desiredSearch), {
      replace: true,
      preventScrollReset: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desiredSearch]);

  const handleFiltersChange = useCallback(
    (newFilters: SearchResultsFilters) => {
      setFilters(newFilters);
      // Immediately sync tab, member-scope flag, and mentions to hook
      if (newFilters.docType !== 'channels') {
        const effectiveTab =
          newFilters.docType === 'all' && newFilters.fromUserIds.length > 0
            ? TabType.MESSAGES
            : docTypeToTabType(newFilters.docType);
        setActiveTab(effectiveTab);
      }
      setOnlyMyChannels(newFilters.onlyMyChannels);
      setExactMatch(newFilters.exactMatch);
      setSelectedMentions(buildChips(newFilters, filterResolvers));
      setStructuredFilters(buildSearchFilters(newFilters));
    },
    [
      setActiveTab,
      setOnlyMyChannels,
      setExactMatch,
      setSelectedMentions,
      setStructuredFilters,
      mentionUserName,
      mentionChannelName,
    ],
  );
  handleFiltersChangeRef.current = handleFiltersChange;

  // Editing the query in the header re-runs the search through the URL, the same path a
  // cmd+K search takes, so back/forward and the overlay's query restore keep working.
  // Filters live in their own params and are deliberately left untouched. Safe to write
  // separately: this runs from a user event, not alongside the combined effect above.
  const handleQuerySubmit = useCallback(
    (next: string) => {
      if (next === query) return;
      setSearchParams(
        prev => {
          const params = new URLSearchParams(prev);
          if (next) params.set('query', next);
          else params.delete('query');
          // Drop the stale `display` label; the combined URL effect rebuilds it from the
          // new query plus the filters that are still applied.
          params.delete('display');
          return params;
        },
        { preventScrollReset: true },
      );
    },
    [query, setSearchParams],
  );

  // Use filteredLocalChannels from the hook (same data pipeline as cmdK).
  // Guard against empty query so we don't show all channels before the user types.
  const localChannelResults = useMemo((): DisplaySearchResult[] => {
    if (!isChannelsMode && filters.docType !== 'all') return [];
    if (!displayQuery) return [];
    return filteredLocalChannels.map(({ channel: c, searchableNames }) => {
      const isDm = isDMChannel(c.scopeType);
      const title = isDm ? searchableNames?.join(', ') || c.name : c.name;
      return {
        type: 'channel' as const,
        id: c.id,
        title,
        subtitle: '',
        relevanceScore: 1,
        metadata: {},
      };
    });
  }, [isChannelsMode, filters.docType, displayQuery, filteredLocalChannels]);

  // Single "narrowing filter active" flag (from:/in:/assignee: + priority:, not the
  // onlyMyChannels scope toggle) — shared by result stripping and local-section suppression.
  const filtersActive = hasActiveFilters(filters) || !!filters.priority;

  const baseResults = useMemo(() => {
    if (isChannelsMode) return localChannelResults;
    if (filters.docType === 'all') {
      if (filtersActive) {
        // A narrowing filter is active — only message/file/ticket results are relevant.
        return backendResults.filter(r => r.type !== 'user' && r.type !== 'channel');
      }
      // For ALL tab, users and channels come from local Zero data (same as cmdK popup).
      // Strip them from backend results to avoid duplicates and use local versions.
      const vespaOnly = backendResults.filter(r => r.type !== 'user' && r.type !== 'channel');
      const localUserResults: DisplaySearchResult[] = filteredLocalUsers.map(user => ({
        id: user.id,
        type: 'user' as const,
        title: user.name,
        subtitle: user.email || '',
        relevanceScore: 1,
        metadata: {},
      }));
      return [...localUserResults, ...vespaOnly, ...localChannelResults];
    }
    // The hook retains the previous tab's results while the Desk request starts.
    // Keep stale files/messages from leaking into the full-screen Desk list.
    if (filters.docType === 'desk') {
      return backendResults.filter(
        r => r.type === 'conversation' && r.searchContext?.subApp === 'DESK',
      );
    }
    return backendResults;
  }, [
    isChannelsMode,
    localChannelResults,
    filters.docType,
    filtersActive,
    backendResults,
    filteredLocalUsers,
  ]);

  const results = useMemo(() => {
    if (filters.sortBy === 'relevance' || isChannelsMode) return baseResults;
    return [...baseResults].sort((a, b) => {
      const aTime = a.metadata.timestamp ? new Date(a.metadata.timestamp).getTime() : 0;
      const bTime = b.metadata.timestamp ? new Date(b.metadata.timestamp).getTime() : 0;
      return filters.sortBy === 'newest' ? bTime - aTime : aTime - bTime;
    });
  }, [baseResults, filters.sortBy, isChannelsMode]);

  const autoOpenedResultKeyRef = useRef<string | null>(null);
  const hasManualPanelSelectionRef = useRef(false);
  const filterKey = JSON.stringify([
    filters.docType,
    filters.fromUserIds,
    filters.fromEmails,
    filters.toEmails,
    filters.inChannelIds,
    filters.assigneeIds,
    filters.withUserIds,
    filters.mentionUserIds,
    filters.mentionChannelIds,
    filters.priority,
    filters.includeBotMessages,
    filters.onlyMyChannels,
    filters.rankProfile,
    structuredFiltersKey,
  ]);
  const searchRequestKey = JSON.stringify([query, filterKey]);
  const fullSearchKey = JSON.stringify([searchRequestKey, filters.sortBy]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query]);

  // Reset auto-open and close stale panel whenever the search or any filter changes
  useEffect(() => {
    autoOpenedResultKeyRef.current = null;
    hasManualPanelSelectionRef.current = false;
    setSelectedPanel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullSearchKey]);

  const handleSelectThread = useCallback((thread: SearchResultsThread) => {
    hasManualPanelSelectionRef.current = true;
    setSelectedPanel({ kind: 'thread', thread });
  }, []);
  const handleSelectUser = useCallback((userId: string) => {
    hasManualPanelSelectionRef.current = true;
    setSelectedPanel({ kind: 'profile', userId });
  }, []);
  const handleSelectChannelContext = useCallback(
    (
      channelId: string,
      conversationId: string,
      conversationCreatedAt?: number,
      matchedMessageId?: string | null,
    ) => {
      hasManualPanelSelectionRef.current = true;
      setSelectedPanel({
        kind: 'channel',
        channelId,
        conversationId,
        ...(conversationCreatedAt !== undefined && { conversationCreatedAt }),
        matchedMessageId: matchedMessageId ?? null,
      });
    },
    [],
  );
  const handleClosePanel = (): void => {
    hasManualPanelSelectionRef.current = true;
    setSelectedPanel(null);
  };

  // Auto-open the first result once results arrive for a new search (desktop only)
  useEffect(() => {
    if (isMobile || isLoading) return;
    if (hasManualPanelSelectionRef.current) return;

    const autoOpenableTypes =
      filters.docType === 'messages'
        ? new Set<DisplaySearchResult['type']>(['conversation'])
        : filters.docType === 'tickets'
          ? new Set<DisplaySearchResult['type']>(['ticket'])
          : filters.docType === 'all'
            ? new Set<DisplaySearchResult['type']>(['conversation', 'ticket'])
            : null;

    // Files and other non-message tabs do not have a meaningful thread to preview.
    if (!autoOpenableTypes) return;

    const first = results.find(result => {
      if (!autoOpenableTypes.has(result.type)) return false;
      const resultContext = result.searchContext;
      if (!resultContext?.channelId || !resultContext.conversationId) return false;
      return !(
        resultContext.subApp === 'DESK' ||
        (result.type === 'ticket' &&
          isDeskChannelType(allChannelsForNav.find(c => c.id === resultContext.channelId)?.type))
      );
    });

    if (!first) {
      // A completed search with no previewable result must not retain a stale panel.
      if (autoOpenedResultKeyRef.current !== null) {
        autoOpenedResultKeyRef.current = null;
        setSelectedPanel(null);
      }
      return;
    }

    const ctx = first.searchContext;
    if (!ctx?.channelId || !ctx?.conversationId) return;
    const resultKey = JSON.stringify([
      fullSearchKey,
      first.type,
      first.id,
      ctx.channelId,
      ctx.conversationId,
      ctx.messageId,
    ]);
    if (autoOpenedResultKeyRef.current === resultKey) return;
    autoOpenedResultKeyRef.current = resultKey;

    // Mirror the click-handler routing: open thread panel for any conversation with
    // replies (replyCount > 0), channel context for standalone messages.
    if (ctx.replyCount && ctx.replyCount > 0) {
      setSelectedPanel({
        kind: 'thread',
        thread: {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          matchedMessageId: ctx.messageId ?? null,
        },
      });
    } else {
      setSelectedPanel({
        kind: 'channel',
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
        matchedMessageId: ctx.messageId ?? null,
      });
    }
  }, [results, isMobile, isLoading, filters.docType, fullSearchKey, allChannelsForNav]);

  const contextValue = useMemo(
    () => ({
      onSelectThread: handleSelectThread,
      onSelectUser: handleSelectUser,
      onSelectChannelContext: handleSelectChannelContext,
    }),
    [handleSelectThread, handleSelectUser, handleSelectChannelContext],
  );

  const currentTab = docTypeToTabType(filters.docType);
  const totalCount = isChannelsMode
    ? localChannelResults.length
    : (paginationState[currentTab]?.total ?? 0);

  // Highlighted ticket strings (subject + id, with `<hi>` match markers) keyed
  // by xyneId, so the ticket widget embedded in each result card can highlight
  // the matched text in place. Only tickets whose subject/id actually matched
  // get an entry — everything else falls back to plain text.
  const ticketHighlightMap = useMemo(() => {
    const map = new Map<string, TicketSearchHighlight>();
    for (const r of results) {
      if (r.type !== 'ticket') continue;
      const xyneId = r.searchContext?.xyneId;
      if (!xyneId) continue;
      const titleHtml = r.title?.includes('<hi>') ? r.title : undefined;
      // Backend subtitle leads with the xyneId ("VAI-<hi>0004</hi> | Status | …").
      // Only accept it if, once `<hi>` is stripped, it matches the plain xyneId — so a
      // subtitle-format change degrades to no highlight instead of highlighting the wrong text.
      const idSegment = r.subtitle?.split(' | ')[0];
      const xyneIdHtml =
        idSegment?.includes('<hi>') && idSegment.replace(/<\/?hi>/g, '') === xyneId
          ? idSegment
          : undefined;
      if (titleHtml || xyneIdHtml) {
        map.set(xyneId, {
          ...(titleHtml && { titleHtml }),
          ...(xyneIdHtml && { xyneIdHtml }),
        });
      }
    }
    return map;
  }, [results]);

  const resultsColumn = (
    <div className='relative flex flex-col h-full min-h-0'>
      <div className='shrink-0 px-4'>
        <div className='pt-4 flex items-center gap-2'>
          {/* This page is only ever arrived at from somewhere — the cmd+K palette, or a
              link out of it — and it is the one screen that renders no AppNavigator, so it
              had no in-app way back at all. Going back lands on the palette's own history
              entry, which reopens cmd+K with the search still in it. */}
          <button
            type='button'
            aria-label='Back'
            onClick={() => void navigate(-1)}
            className='size-7 shrink-0 flex items-center justify-center rounded-[10px] border border-transparent transition-colors text-sidebar-secondary-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent'
            data-track-category='SEARCH_RESULTS'
            data-track-name='GO_BACK'
          >
            <ArrowLeft size={16} />
          </button>
          {/* Paired with Back so a step backwards is undoable — refining a query pushes
              history entries, and without this the only way forward is retyping. Mirrors
              Back exactly, including staying enabled: forward past the end of the stack
              is a harmless no-op. */}
          <button
            type='button'
            aria-label='Forward'
            onClick={() => void navigate(1)}
            className='size-7 shrink-0 flex items-center justify-center rounded-[10px] border border-transparent transition-colors text-sidebar-secondary-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent'
            data-track-category='SEARCH_RESULTS'
            data-track-name='GO_FORWARD'
          >
            <ArrowRight size={16} />
          </button>
          <div className='flex-1 min-w-0'>
            <SearchQueryInput
              query={query}
              tokens={queryTokens}
              filters={filters}
              onFiltersChange={handleFiltersChange}
              onSubmit={handleQuerySubmit}
              onLiveChange={setText}
              isSearching={isLoading}
            />
          </div>
        </div>
        <div className='mt-3'>
          <SearchFilterBar filters={filters} onFiltersChange={handleFiltersChange} />
        </div>
        {(results.length > 0 || (query && totalCount > 0)) && (
          <div className='flex items-center justify-between gap-3 pb-2'>
            <p className='text-xs text-muted-foreground tabular-nums'>
              {(totalCount || results.length).toLocaleString()} results
            </p>
            <button
              onClick={() => setCompareMode(v => !v)}
              title='Compare how results ranked'
              data-track-category='SEARCH_RESULTS'
              data-track-name='TOGGLE_COMPARE'
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md active:scale-[0.96] transition',
                compareMode
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border',
              )}
            >
              <GitCompare size={13} />
              Compare
            </button>
          </div>
        )}
      </div>
      <div
        ref={scrollRef}
        className={cn(
          // pb-16 so the last card clears the bottom of the viewport instead of sitting
          // flush against it (and above the floating compare bar when it's up).
          'flex-1 min-h-0 overflow-y-auto px-4 pb-16',
          // A re-search keeps the previous results on screen rather than blanking to a
          // spinner — they fade back while the new ones land, and the box spins.
          isLoading && results.length > 0 && 'opacity-50 transition-opacity duration-150',
        )}
      >
        <TicketSearchHighlightContext.Provider value={ticketHighlightMap}>
          <ResultsBody
            query={query}
            displayQuery={displayQuery}
            hasActiveFilters={filtersActive}
            isSearchPending={isSearchPending}
            isLoading={isLoading}
            error={error}
            results={results}
            loadMoreRef={loadMoreRef}
            selectedPanel={selectedPanel}
            onSelectUser={handleSelectUser}
            channelData={allChannelsForNav}
            searchableChannels={allChannelsWithCategory}
            usersById={usersById}
            compareMode={compareMode}
            isGrouped={isGrouped}
            selectedIds={selectedIds}
            relevantIds={relevantIds}
            onToggleSelect={toggleSelect}
            docType={filters.docType}
            filteredLocalChannels={filteredLocalChannels}
          />
        </TicketSearchHighlightContext.Provider>
      </div>

      <div className='pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center'>
        <AnimatePresence>
          {compareMode && selected.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
              className='pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/95 backdrop-blur shadow-lg py-1.5 pl-4 pr-1.5'
            >
              <span className='text-xs text-foreground'>
                <span className='font-semibold tabular-nums'>{selected.length}</span> selected
              </span>
              <button
                onClick={clearSelection}
                data-track-category='SEARCH_RESULTS'
                data-track-name='CLEAR_COMPARE'
                className='text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-full hover:bg-muted active:scale-[0.96] transition'
              >
                Clear
              </button>
              <button
                onClick={() => setCompareOpen(true)}
                disabled={selected.length < 2}
                data-track-category='SEARCH_RESULTS'
                data-track-name='OPEN_COMPARE'
                className='inline-flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground px-3 py-1.5 rounded-full shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.96] transition'
              >
                <GitCompare size={13} />
                Compare in depth
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  return (
    <SearchResultsContext.Provider value={contextValue}>
      <div
        className='h-full flex flex-col relative bg-background overflow-hidden md:rounded-2xl shadow-md'
        data-id='search-results-screen'
      >
        <div className='flex-1 flex min-h-0 relative'>
          {isMobile ? (
            <MobileLayout
              selectedPanel={selectedPanel}
              onClose={handleClosePanel}
              resultsColumn={resultsColumn}
            />
          ) : (
            <DesktopLayout
              selectedPanel={selectedPanel}
              onClose={handleClosePanel}
              resultsColumn={resultsColumn}
            />
          )}
        </div>

        <SearchCompareDialog
          open={compareOpen}
          query={query}
          results={selected}
          relevantIds={relevantIds}
          onToggleRelevant={toggleRelevant}
          onRemove={removeFromCompare}
          onClose={closeCompare}
        />
      </div>
    </SearchResultsContext.Provider>
  );
};
export default SearchResults;

// —— Inline subcomponents ———

interface ResultsBodyProps {
  query: string;
  /** The text the visible results reflect (live typed text, falling back to the URL
   *  query). Drives empty-state copy and local-section gating so they track live typing. */
  displayQuery: string;
  hasActiveFilters: boolean;
  isSearchPending: boolean;
  isLoading: boolean;
  error: string | null;
  results: DisplaySearchResult[];
  loadMoreRef: React.RefObject<HTMLDivElement | null>;
  selectedPanel: SidePanelState;
  onSelectUser: (userId: string) => void;
  channelData: ReturnType<typeof useAllChannels>;
  searchableChannels: Array<{
    channel: Channel;
    category: ChannelCategory;
    searchableNames?: string[];
  }>;
  usersById: Map<string, Parameters<typeof getUserDisplayName>[0]>;
  compareMode: boolean;
  isGrouped: boolean;
  selectedIds: Set<string>;
  relevantIds: Set<string>;
  onToggleSelect: (result: DisplaySearchResult) => void;
  docType: SearchResultsFilters['docType'];
  filteredLocalChannels: Array<{
    channel: Channel;
    category: ChannelCategory;
    searchableNames?: string[];
  }>;
}

// Group key assignment — mirrors cmdK's groupedBackendResults logic
const getResultGroupKey = (result: DisplaySearchResult): string => {
  if (result.searchContext?.subApp === 'DESK') return 'desk';
  if (result.type === 'attachment') {
    const sub = result.searchContext?.subApp?.toLowerCase();
    if (sub === 'canvas') return 'canvas';
    if (sub === 'transcript') return 'transcript';
    if (sub === 'recording') return 'recording';
    return 'attachment';
  }
  return result.type;
};

// Backend-only group order — local sections (users, channels) are rendered separately above.
const BACKEND_GROUP_ORDER = [
  'conversation',
  'ticket',
  'attachment',
  'canvas',
  'transcript',
  'recording',
  'desk',
] as const;

// Labels mirror cmdK's getGroupLabel exactly
const GROUP_LABELS: Record<string, string> = {
  conversation: 'Messages',
  ticket: 'Tickets',
  attachment: 'Attachments',
  canvas: 'Canvas',
  transcript: 'Calls',
  recording: 'Recordings',
  desk: 'Desk',
  others: 'Others',
};

const CATEGORY_LABELS: Record<string, string> = {
  [ChannelCategory.STARRED]: 'Starred',
  [ChannelCategory.CHANNELS]: 'Channels',
  [ChannelCategory.DIRECT_MESSAGES]: 'Direct Messages',
  [ChannelCategory.GROUP_DMS]: 'Group DMs',
};

const LOCAL_SECTION_DISPLAY_LIMIT = 5;

function UserResultCard({
  result,
  onSelectUser,
}: {
  result: DisplaySearchResult;
  onSelectUser: (userId: string) => void;
}): ReactElement {
  const user = useUser(result.id);
  const isDeactivated = isUserDeactivated(user);

  if (!user) {
    return (
      <div className='w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card'>
        <div className='size-9 rounded-full bg-muted animate-pulse shrink-0' />
        <div className='min-w-0 flex-1 space-y-1'>
          <div className='h-3.5 w-32 bg-muted animate-pulse rounded' />
          <div className='h-3 w-24 bg-muted animate-pulse rounded' />
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelectUser(result.id)}
      className='w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left'
      data-track-category='SEARCH_RESULTS'
      data-track-name='OPEN_USER'
    >
      <Avatar userId={result.id} size='md' showActiveStatus={false} />
      <div className='min-w-0'>
        <div className='flex items-center gap-2 min-w-0'>
          <p
            className={cn(
              'text-sm font-medium truncate',
              isDeactivated ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {result.title}
          </p>
          {isDeactivated && (
            <span className='text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0'>
              Deactivated
            </span>
          )}
        </div>
        {result.subtitle && (
          <p className='text-xs text-muted-foreground truncate'>{result.subtitle}</p>
        )}
      </div>
    </button>
  );
}

function getAttachmentResultIcon(result: DisplaySearchResult): ReactElement {
  const subApp = result.searchContext?.subApp?.toUpperCase();

  switch (subApp) {
    case 'CANVAS':
      return <FileText className='size-4 text-muted-foreground' />;
    case 'TRANSCRIPT':
      return <Mic className='size-4 text-muted-foreground' />;
    case 'DESK':
      return <Mail className='size-4 text-muted-foreground' />;
    default:
      return <Paperclip className='size-4 text-muted-foreground' />;
  }
}

function ResultsBody({
  query,
  displayQuery,
  hasActiveFilters,
  isSearchPending,
  isLoading,
  error,
  results,
  loadMoreRef,
  selectedPanel,
  onSelectUser,
  channelData,
  searchableChannels,
  usersById,
  compareMode,
  isGrouped,
  selectedIds,
  relevantIds,
  onToggleSelect,
  docType,
  filteredLocalChannels,
}: ResultsBodyProps): ReactElement {
  const navigate = useNavigate();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  // `searchableNames` is already the rendered form: getDMNames(...).display for DMs
  // (participant names — `channel.name` is a participant id there) and [channel.name]
  // for everything else. That is `formatChannelLabel` without its `#`, which rows
  // supplying their own lead-in ("in design") don't want.
  const channelLabelsById = useMemo(
    () =>
      new Map(
        searchableChannels.map(channel => [
          channel.channel.id,
          (channel.searchableNames?.length ? channel.searchableNames : [channel.channel.name]).join(
            ', ',
          ),
        ]),
      ),
    [searchableChannels],
  );

  // Reset expand state when query changes
  useEffect(() => {
    if (!query.trim()) setExpandedCategories(new Set());
  }, [query]);

  const toggleExpand = (key: string): void => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Renders a single result card — shared between flat and grouped views
  const renderCard = (result: DisplaySearchResult): ReactElement | null => {
    const key = `${result.type}-${result.id}`;

    // User card — opens profile panel
    if (result.type === 'user') {
      return <UserResultCard key={key} result={result} onSelectUser={onSelectUser} />;
    }

    // Channel card
    if (result.type === 'channel') {
      const channelId = result.searchContext?.channelId ?? result.id;
      const channel = channelData?.find(c => c.id === channelId);
      const isDeskChannel = isDeskChannelType(channel?.type);
      return (
        <button
          key={key}
          onClick={() =>
            void navigate(isDeskChannel ? `/support/${channelId}` : `/chat/dir/${channelId}`)
          }
          className='w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left'
          data-track-category='SEARCH_RESULTS'
          data-track-name={isDeskChannel ? 'OPEN_DESK_CHANNEL' : 'OPEN_CHANNEL'}
        >
          <div className='flex items-center justify-center size-9 rounded-lg bg-muted shrink-0'>
            {isDeskChannel ? (
              <Mail className='size-4 text-muted-foreground' />
            ) : (
              <Hash className='size-4 text-muted-foreground' />
            )}
          </div>
          <div className='min-w-0'>
            <p className='text-sm font-medium text-foreground truncate'>
              <RenderMessageWithHTML message={result.title} />
            </p>
            {result.subtitle && result.subtitle !== 'Channel' && (
              <p className='text-xs text-muted-foreground truncate'>
                <RenderMessageWithHTML message={result.subtitle} />
              </p>
            )}
          </div>
        </button>
      );
    }

    // Attachment / file card
    if (result.type === 'attachment') {
      const icon = getAttachmentResultIcon(result);
      const channelId = result.searchContext?.channelId;
      const channelName = channelId ? channelLabelsById.get(channelId) : undefined;
      const uploaderId = result.avatar;
      const uploader = uploaderId ? usersById.get(uploaderId) : undefined;
      const uploaderName = uploader ? getUserDisplayName(uploader) : '';
      const shouldShowUploader = !!uploader && uploaderName !== 'Unknown';
      const rawTs = result.metadata.timestamp;
      const uploadedAt = rawTs && rawTs !== 'N/A' ? utcToIst(rawTs) : '';
      const fileSize = result.searchContext?.fileSize;
      const fileSizeLabel = typeof fileSize === 'number' ? formatFileSize(fileSize) : '';
      // Same shape as every other card on this screen: metadata left, timestamp
      // right. Segments are middot-separated, except the channel, which closes
      // the line as a phrase ("in design") and so takes no separator in front.
      const metaLine = [shouldShowUploader ? `Uploaded by ${uploaderName}` : '', fileSizeLabel]
        .filter(Boolean)
        .join(' · ');
      const infoLine = [metaLine, channelName ? `in ${channelName}` : ''].filter(Boolean).join(' ');

      return (
        <button
          key={key}
          onClick={() => void navigateToSearchResult(result, navigate, channelData)}
          className='w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left'
          data-track-category='SEARCH_RESULTS'
          data-track-name='OPEN_ATTACHMENT'
        >
          <div className='flex items-center justify-center size-9 rounded-lg bg-muted shrink-0'>
            {icon}
          </div>
          <div className='min-w-0 flex-1'>
            {/* Timestamp sits on the title row, matching the ticket and message
                cards; the metadata line below carries only metadata. */}
            <div className='flex items-baseline justify-between gap-2'>
              <p className='min-w-0 flex-1 truncate text-sm font-medium text-foreground'>
                <RenderMessageWithHTML message={result.title} />
              </p>
              {uploadedAt && (
                <span className='shrink-0 whitespace-nowrap text-xs text-muted-foreground'>
                  {uploadedAt}
                </span>
              )}
            </div>
            <span className='block min-w-0 truncate text-xs text-muted-foreground'>
              {infoLine ||
                (result.subtitle ? <RenderMessageWithHTML message={result.subtitle} /> : null)}
            </span>
          </div>
        </button>
      );
    }

    // Conversation message card (type === 'conversation')
    // DESK mails navigate away; regular messages open in the side panel
    if (result.type === 'conversation' && result.searchContext?.subApp === 'DESK') {
      // Mirrors cmdK's desk-mail row: subject and timestamp, then sender +
      // recipient count, then the body snippet.
      const senderName = result.searchContext?.senderName || result.subtitle || '';
      const recipientCount = result.searchContext?.recipientCount ?? 0;
      const sentAt = utcToIst(result.metadata.timestamp);
      const deskTicketSubtitle = [
        result.subtitle || result.searchContext.xyneId,
        ...(result.searchContext.formFieldMatches ?? []).map(
          field => `${field.fieldName ?? field.fieldId}: ${field.fieldValue}`,
        ),
      ]
        .filter(Boolean)
        .join(' | ');
      return (
        <button
          key={key}
          onClick={() => void navigateToSearchResult(result, navigate, channelData)}
          className='w-full flex items-start gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left'
          data-track-category='SEARCH_RESULTS'
          data-track-name='OPEN_MAIL'
        >
          <div className='flex items-center justify-center size-9 rounded-lg bg-muted shrink-0'>
            <Mail className='size-4 text-muted-foreground' />
          </div>
          <div className='min-w-0 flex-1'>
            {/* Timestamp sits on the subject row, matching the ticket and message
                cards; the metadata line below carries only metadata. */}
            <div className='flex items-baseline justify-between gap-2'>
              <p className='min-w-0 flex-1 truncate text-sm font-medium text-foreground'>
                <RenderMessageWithHTML message={result.title} />
              </p>
              {sentAt && (
                <span className='shrink-0 whitespace-nowrap text-xs text-muted-foreground'>
                  {sentAt}
                </span>
              )}
            </div>
            {deskTicketSubtitle && (
              <div className='text-xs text-foreground truncate'>
                <RenderMessageWithHTML message={deskTicketSubtitle} />
              </div>
            )}
            <span className='block min-w-0 truncate text-xs text-muted-foreground'>
              {senderName}
              {recipientCount > 0 && ` +${recipientCount} more`}
            </span>
            {result.context && (
              <div className='mt-0.5 text-xs text-muted-foreground'>
                <SearchSnippetRenderer message={result.context} wordLimit={40} />
              </div>
            )}
          </div>
        </button>
      );
    }

    const ctx = result.searchContext;
    if (!ctx?.channelId || !ctx?.conversationId) return null;
    const isTicket = result.type === 'ticket';
    const isDeskTicket =
      isTicket && isDeskChannelType(channelData?.find(c => c.id === ctx.channelId)?.type);

    // Ticket summary from the search fields — desk tickets render it as a compact
    // card; normal tickets serialize it into ticket_md so the message bubble shows
    // the embedded widget without fetching the conversation.
    const ticketSummary = isTicket
      ? {
          id: ctx.ticketId ?? result.id,
          title: result.title,
          description: result.context ?? '',
          xyneId: ctx.xyneId ?? null,
          stageName: ctx.stageName ?? null,
          assignedTo: ctx.assignedTo ?? null,
          createdBy: ctx.createdBy ?? null,
          createdAt: ctx.createdAtTimestamp ?? null,
          ticketType: ctx.ticketType ?? null,
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          statusV2: (ctx.ticketStatus as TicketStatusV2 | undefined) ?? null,
          priority: (ctx.priority as TicketPriority | undefined) ?? null,
        }
      : null;

    // Desk tickets: their message-bound widget can't render (bot/AI initial
    // message, missing ticket_md), so render a compact data-driven ticket card.
    if (isDeskTicket && ticketSummary) {
      return (
        <div
          key={key}
          className='w-full'
          data-track-category='SEARCH_RESULTS'
          data-track-name='OPEN_DESK_TICKET_RESULT'
        >
          <TicketCardV2
            ticket={ticketSummary}
            isConversation
            width='max-w-none w-full'
            onClick={() => void navigateToSearchResult(result, navigate, channelData)}
          />
        </div>
      );
    }

    // Conversations + normal tickets render as the message bubble, built entirely
    // from the Vespa payload (no entity queries). Tickets carry a serialized
    // ticket_md so ChatBubble renders the embedded ticket widget.
    const ticketMd = ticketSummary ? (serializeTicketMd(ticketSummary) ?? undefined) : undefined;
    return (
      <SearchResultMessageCard
        key={key}
        channelId={ctx.channelId}
        conversationId={ctx.conversationId}
        matchedMessageId={ctx.messageId ?? null}
        {...(isTicket && { displayMessageId: ctx.messageId ?? result.id })}
        {...(result.context && { searchSnippet: result.context })}
        searchThread={{
          isRootMessage: isTicket ? true : (ctx.isRootMessage ?? false),
          replyCount: ctx.replyCount ?? 0,
          senderId: isTicket ? (ctx.createdBy ?? '') : (ctx.senderId ?? ''),
          msgType: isTicket ? MessageType.USER : toMessageType(ctx.msgType),
          createdAt: ctx.createdAtTimestamp ?? 0,
          ...(ticketMd && { ticketMd }),
          ...(ctx.threadSenders && { threadSenders: ctx.threadSenders }),
          ...(ctx.attachmentIds?.length && { attachmentIds: ctx.attachmentIds }),
        }}
        isSelected={
          (selectedPanel?.kind === 'channel' &&
            selectedPanel.conversationId === ctx.conversationId &&
            selectedPanel.matchedMessageId === (ctx.messageId ?? null)) ||
          (selectedPanel?.kind === 'thread' &&
            selectedPanel.thread.conversationId === ctx.conversationId &&
            selectedPanel.thread.matchedMessageId === (ctx.messageId ?? null))
        }
      />
    );
  };

  const footer = (
    <>
      {/* Sentinel for load-more */}
      <div ref={loadMoreRef} className='h-1' />
      {isLoading && (
        <div className='flex justify-center py-4'>
          <Loader2 className='animate-spin text-muted-foreground' size={20} />
        </div>
      )}
    </>
  );

  // ── Error state (all tabs) ──────────────────────────────────────────────
  if (error) {
    return (
      <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
        <p className='text-destructive text-base font-semibold mb-2'>Search failed</p>
        <p className='text-muted-foreground text-sm'>{error}</p>
      </div>
    );
  }

  // ── Grouped view — ALL tab, non-compare ─────────────────────────────────
  // Checked BEFORE the results.length===0 guards so local sections (users,
  // channels) are always visible even when backend results are still loading
  // or empty — mirrors cmdK popup (non-screen) ALL tab behaviour.
  if (docType === 'all' && !compareMode) {
    // Group backend results only (local users/channels rendered as separate sections)
    const backendOnly = results.filter(r => r.type !== 'user' && r.type !== 'channel');
    const userResults = results.filter(r => r.type === 'user');

    const grouped = new Map<string, DisplaySearchResult[]>();
    for (const result of backendOnly) {
      const gk = getResultGroupKey(result);
      if (!grouped.has(gk)) grouped.set(gk, []);
      grouped.get(gk)!.push(result);
    }

    // Partition local channels by category — mirrors cmdK's groupedChannels
    const starredItems = filteredLocalChannels.filter(
      fc => fc.category === ChannelCategory.STARRED,
    );
    const regularItems = filteredLocalChannels.filter(
      fc => fc.category === ChannelCategory.CHANNELS,
    );
    const dmItems = filteredLocalChannels.filter(
      fc => fc.category === ChannelCategory.DIRECT_MESSAGES,
    );
    // cmdK only shows Group DMs in search mode — 1:1 DMs are not a separate section
    const groupDmItems = dmItems.filter(({ channel }) => isGroupDMChannel(channel.scopeType));

    // Converts a local channel entry to the DisplaySearchResult shape used by renderCard
    const toChannelResult = (c: Channel, searchableNames?: string[]): DisplaySearchResult => {
      const isDm = isDMChannel(c.scopeType);
      return {
        type: 'channel' as const,
        id: c.id,
        title: isDm ? searchableNames?.join(', ') || c.name : c.name,
        subtitle: '',
        relevanceScore: 1,
        metadata: {},
      };
    };
    // Renders a collapsible local channel section — label has NO count (mirrors cmdK)
    const renderLocalChannelSection = (
      category: ChannelCategory,
      items: typeof filteredLocalChannels,
      collapsible = true,
    ): ReactElement | null => {
      if (items.length === 0) return null;
      const sectionKey = category as string;
      const isExpanded = expandedCategories.has(sectionKey);
      const hasMore = collapsible && items.length > LOCAL_SECTION_DISPLAY_LIMIT;
      const displayItems =
        !isExpanded && hasMore ? items.slice(0, LOCAL_SECTION_DISPLAY_LIMIT) : items;
      const hiddenCount = items.length - LOCAL_SECTION_DISPLAY_LIMIT;
      return (
        <div key={sectionKey} className='mb-6'>
          <p className='px-1 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide font-mono'>
            {CATEGORY_LABELS[sectionKey]}
          </p>
          <div className='space-y-2'>
            {displayItems.map(({ channel: c, searchableNames }) =>
              renderCard(toChannelResult(c, searchableNames)),
            )}
          </div>
          {hasMore && (
            <button
              onClick={() => toggleExpand(sectionKey)}
              className='mt-2 px-1 text-xs text-muted-foreground hover:text-foreground hover:underline'
              data-track-category='SEARCH_RESULTS'
              data-track-name='TOGGLE_LOCAL_SECTION'
            >
              {isExpanded ? 'See less' : `See ${hiddenCount} more`}
            </button>
          )}
        </div>
      );
    };

    // Renders the collapsible Users section — label HAS count (mirrors cmdK: "Users (N)")
    const renderUserSection = (): ReactElement | null => {
      if (userResults.length === 0) return null;
      const isExpanded = expandedCategories.has('user');
      const hasMore = userResults.length > LOCAL_SECTION_DISPLAY_LIMIT;
      const displayItems =
        !isExpanded && hasMore ? userResults.slice(0, LOCAL_SECTION_DISPLAY_LIMIT) : userResults;
      const hiddenCount = userResults.length - LOCAL_SECTION_DISPLAY_LIMIT;
      return (
        <div key='user' className='mb-6'>
          <p className='px-1 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide font-mono'>
            Users ({userResults.length})
          </p>
          <div className='space-y-2'>{displayItems.map(result => renderCard(result))}</div>
          {hasMore && (
            <button
              onClick={() => toggleExpand('user')}
              className='mt-2 px-1 text-xs text-muted-foreground hover:text-foreground hover:underline'
              data-track-category='SEARCH_RESULTS'
              data-track-name='TOGGLE_USERS_SECTION'
            >
              {isExpanded ? 'See less' : `See ${hiddenCount} more`}
            </button>
          )}
        </div>
      );
    };

    // Local sections are query-driven — mirrors cmdK's search branch. Without a
    // query, filteredLocalChannels returns every channel, so gate on the query to
    // avoid a partial browse (which would also drop 1:1 DMs) and keep the clean
    // empty state until the user types.
    const showLocalSections = !hasActiveFilters && !!displayQuery;
    const hasLocalSections =
      showLocalSections && (userResults.length > 0 || filteredLocalChannels.length > 0);
    const hasBackendSections = backendOnly.length > 0;

    // True empty: nothing to show at all
    if (!hasLocalSections && !hasBackendSections) {
      if (!displayQuery && !hasActiveFilters) {
        return (
          <EmptyState title='Search for messages, files, and tickets' subtitle='Type to search' />
        );
      }
      // isSearchPending is primary (race-proof); isLoading backstops a real in-flight fetch.
      if (isLoading || isSearchPending) {
        return (
          <div className='flex items-center justify-center h-full'>
            <Loader2 className='animate-spin text-muted-foreground' size={32} />
          </div>
        );
      }
      return (
        <EmptyState
          title='No results found'
          subtitle={
            displayQuery
              ? `Nothing matched "${displayQuery}"`
              : 'No results found for the active filters'
          }
        />
      );
    }

    return (
      <div className='w-full pt-2 pb-6'>
        {/* Local sections — same order as cmdK non-screen popup ALL tab:
            Starred → Users → Group DMs (not collapsible) → Channels
            1:1 DMs are intentionally omitted in search mode (matches cmdK) */}
        {showLocalSections && (
          <>
            {renderLocalChannelSection(ChannelCategory.STARRED, starredItems)}
            {renderUserSection()}
            {renderLocalChannelSection(ChannelCategory.GROUP_DMS, groupDmItems, false)}
            {renderLocalChannelSection(ChannelCategory.CHANNELS, regularItems)}
          </>
        )}
        {/* Backend results: grouped into per-docType sections when the backend
            grouped the response, otherwise a single flat (e.g. time-sorted) list.
            Local users/channels above stay categorized regardless. */}
        {isGrouped
          ? BACKEND_GROUP_ORDER.filter(gk => grouped.has(gk)).map(gk => (
              <div key={gk} className='mb-6'>
                <p className='px-1 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide font-mono'>
                  {GROUP_LABELS[gk]} ({grouped.get(gk)!.length})
                </p>
                <div className='space-y-2'>
                  {grouped.get(gk)!.map(result => renderCard(result))}
                </div>
              </div>
            ))
          : backendOnly.length > 0 && (
              <div className='mb-6'>
                <p className='px-1 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide font-mono'>
                  {GROUP_LABELS['others']} ({backendOnly.length})
                </p>
                <div className='space-y-2'>{backendOnly.map(result => renderCard(result))}</div>
              </div>
            )}
        {footer}
      </div>
    );
  }

  // ── Flat view — specific docType tabs and compare mode ──────────────────
  if (results.length === 0) {
    if (!displayQuery && !hasActiveFilters) {
      return (
        <EmptyState title='Search for messages, files, and tickets' subtitle='Type to search' />
      );
    }
    // isSearchPending is primary (race-proof); isLoading backstops a real in-flight fetch.
    if (isLoading || isSearchPending) {
      return (
        <div className='flex items-center justify-center h-full'>
          <Loader2 className='animate-spin text-muted-foreground' size={32} />
        </div>
      );
    }
    return (
      <EmptyState
        title='No results found'
        subtitle={
          displayQuery
            ? `Nothing matched "${displayQuery}"`
            : 'No results found for the active filters'
        }
      />
    );
  }
  return (
    <div className='w-full space-y-2 pt-2 pb-6'>
      {results.map((result, index) => {
        const el = renderCard(result);
        if (!el) return null;
        if (!compareMode) return el;
        const key = `${result.type}-${result.id}`;
        return (
          <CompareSelectRow
            key={key}
            rank={index + 1}
            score={result.relevanceScore}
            selected={selectedIds.has(result.id)}
            relevant={relevantIds.has(result.id)}
            hasDebug={hasRankingData(result)}
            onToggle={() => onToggleSelect(result)}
          >
            {el}
          </CompareSelectRow>
        );
      })}
      {footer}
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle?: string }): ReactElement {
  return (
    <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
      <MessageCircle className='text-muted-foreground mb-4' size={64} />
      <p className='text-muted-foreground text-xl font-semibold mb-2'>{title}</p>
      {subtitle && <p className='text-muted-foreground text-sm'>{subtitle}</p>}
    </div>
  );
}

interface LayoutProps {
  selectedPanel: SidePanelState;
  onClose: () => void;
  resultsColumn: ReactElement;
}

function MobileLayout({ selectedPanel, onClose, resultsColumn }: LayoutProps): ReactElement {
  return (
    <>
      <div className='flex-1 min-w-0 flex flex-col min-h-0'>{resultsColumn}</div>
      {selectedPanel && (
        <div className='absolute inset-0 z-20 bg-background flex flex-col animate-slide-in-from-right'>
          {selectedPanel.kind === 'thread' && (
            <div className='flex items-center justify-end p-2 border-b border-border'>
              <button
                onClick={onClose}
                className='p-2 rounded-md hover:bg-accent'
                aria-label='Close thread'
                data-track-category='SEARCH_RESULTS'
                data-track-name='CLOSE_THREAD_PANEL'
              >
                <X size={18} />
              </button>
            </div>
          )}
          <div className='flex-1 min-h-0'>
            <SearchResultsSidePanel panel={selectedPanel} onClose={onClose} />
          </div>
        </div>
      )}
    </>
  );
}

function DesktopLayout({ selectedPanel, onClose, resultsColumn }: LayoutProps): ReactElement {
  return (
    <ResizableGroup
      orientation='horizontal'
      className='h-full'
      autoSaveId='search-results-thread'
      panelIds={selectedPanel ? ['search-results', 'search-side-panel'] : ['search-results']}
    >
      <Panel
        id='search-results'
        defaultSize={selectedPanel ? '60%' : '100%'}
        minSize={selectedPanel ? '30%' : '100%'}
      >
        <div className='h-full'>{resultsColumn}</div>
      </Panel>
      {selectedPanel && (
        <>
          <Separator className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
            <div className='w-[1px] h-full bg-border' />
          </Separator>
          <Panel id='search-side-panel' defaultSize='40%' minSize='25%'>
            <div className='h-full animate-slide-in-from-right'>
              <SearchResultsSidePanel panel={selectedPanel} onClose={onClose} />
            </div>
          </Panel>
        </>
      )}
    </ResizableGroup>
  );
}

function SearchResultsSidePanel({
  panel,
  onClose,
}: {
  panel: NonNullable<SidePanelState>;
  onClose: () => void;
}): ReactElement {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();

  return (
    <div className='h-full flex flex-col min-h-0 bg-background'>
      {panel.kind === 'channel' ? (
        <ConversationPanelV2
          channelId={panel.channelId}
          previousChannelId={null}
          linkedConversationIdOverride={panel.conversationId}
          linkedItemCreatedAtOverride={panel.conversationCreatedAt ?? null}
          onClose={onClose}
        />
      ) : panel.kind === 'thread' ? (
        <ThreadMessages
          channelId={panel.thread.channelId}
          conversationId={panel.thread.conversationId}
          matchedMessageId={panel.thread.matchedMessageId ?? null}
          showChannelLink
          onChannelLinkClick={() =>
            void navigate(
              `/chat/dir/${panel.thread.channelId}#origin=${panel.thread.conversationId}`,
            )
          }
          onClose={onClose}
        />
      ) : (
        <>
          <div className='flex items-center justify-end p-2 border-b border-border shrink-0'>
            <button
              onClick={onClose}
              className='p-2 rounded-md hover:bg-accent'
              aria-label='Close profile'
              data-track-category='SEARCH_RESULTS'
              data-track-name='CLOSE_PROFILE_PANEL'
            >
              <X size={18} />
            </button>
          </div>
          <div className='flex-1 min-h-0 overflow-y-auto'>
            <UserProfile
              userId={panel.userId}
              isOwnProfile={currentUser?.id === panel.userId}
              className='border-0 rounded-none shadow-none'
            />
          </div>
        </>
      )}
    </div>
  );
}
