import {
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from '@xyne/icons';
import { ResizableGroup, Panel, Separator } from '../../ui/Resizable/Resizable';
import {
  FileText,
  GitCompare,
  Loader2,
  Mail,
  Minimize2,
  MessageCircle,
  MessageSquare,
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
import { usePlatform } from '../../../hooks/usePlatform';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { Tooltip } from '../../ui/Tooltip';
import {
  collapseToCmdk,
  markFullPageReady,
  recordCollapseToModal,
  recordFullPageSnackbar,
  recordUndoFullPageDefault,
  resultsParamsForQuery,
  SELECTED_RESULT_PARAM,
  takeFullPageAnnouncement,
  takeFullPageOrigin,
  drawPageUnderFullPage,
  watchBackFromFullPage,
  FOCUS_FULL_PAGE_SEARCH_EVENT,
  FULL_PAGE_QUERY_INPUT_ID,
  isDialogOpenOverPage,
  isFullPageSearchPath,
  TYPED_QUERY_STATE_KEY,
} from '../ChatDirectory/cmdkFullPage';
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
import { SearchFilterBar, buildFilterSummary, sortSummary } from './SearchFilterBar';
import { SearchQueryInput, type QueryToken } from './SearchQueryInput';
import { parseSearchFilters } from '../../../utils/searchFilterParser';
import {
  useAllVisibleChannels,
  useAllChannels,
  useUserChannelStatuses,
} from '../../../hooks/useChannels';
import { useSearchMetrics } from '../../../hooks/useSearchMetrics';
import type { VisibleChannel } from '../../../machines/stateMachine';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { useUser, useUsers } from '../../../hooks/useUsers';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { makeMentionHighlightsBuilder } from '../../../search/mentionHighlights';
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
  tabLabel,
  RECENTS_STARRED_CAP,
  MERGED_DISPLAY_LIMIT,
  MERGED_CANDIDATE_LIMIT,
} from '../ChatDirectory/ChannelCommandMenu.types';
import {
  saveCurrentSearchQuery,
  identityKeyFor,
  RecentSearches,
  useRecentSearches,
  type RecentSearchEntry,
} from '../ChatDirectory/RecentSearches';
import { Command } from 'cmdk';
import { mergeRankedCandidates } from '@xyne/shared/utils';
import { rankChannelsByAffinity, toChannelCandidates } from '../../../utils/rankingUtils';
import { useAffinityCallback } from '../../../hooks/useAffinityCallback';
import { FullPageSnackbar } from '../ChatDirectory/FullPageSnackbar';
import { ChannelCategory } from '../ChatDirectory/ChatDirectory.types';
import { Channel, ChannelVisibility } from '@xyne/shared';
import { resolveOrCreateDmChannelId } from '../../../utils/searchNavigation';
import { toast } from 'sonner';
import Avatar from '../../ui/Avatar/Avatar';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../../../utils/classNames';
import { CompareSelectRow } from './compare/CompareSelectRow';
import { SearchCompareDialog } from './compare/SearchCompareDialog';
import { SearchFeedbackPopover, useCanPostSearchFeedback } from '../SearchFeedback';
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
import type { SidePanelState } from './SidePanel/PanelTypes';
import { SearchResultsSidePanel } from './SidePanel/SidePanel';
import { resolveResultClick } from './SidePanel/ResultClickResolver';
import ChannelIcon from '../ChannelIcon/ChannelIcon';

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

// Any filter that narrows the search, beyond hasActiveFilters' people and places: with one set,
// the page has a search to show even with nothing typed. The scope toggles, sort and rank profile
// only shape a search, so they don't count.
function narrowsSearch(filters: SearchResultsFilters): boolean {
  return (
    hasActiveFilters(filters) ||
    !!filters.priority ||
    filters.fromEmails.length > 0 ||
    filters.toEmails.length > 0 ||
    filters.mentionUserIds.length > 0 ||
    filters.mentionChannelIds.length > 0 ||
    filters.mentionUserGroupIds.length > 0 ||
    filters.statuses.length > 0 ||
    filters.boardIds.length > 0 ||
    filters.tags.length > 0 ||
    filters.entities.length > 0 ||
    !!filters.dateRange ||
    !!filters.after ||
    !!filters.before
  );
}

function toMessageType(value?: string): MessageType {
  return (Object.values(MessageType) as string[]).includes(value ?? '')
    ? (value as MessageType)
    : MessageType.USER;
}

// Marks each result card with its result id — the order the arrow keys walk.
const RESULT_CARD_ATTR = 'data-result-card-id';
// A control that owns the keys while it has focus.
// The side panel next to the results (a channel, thread, profile, attachment...): its keys are its
// own.
const SIDE_PANEL_ATTR = 'data-search-side-panel';
const FOCUSABLE_CONTROL =
  'input, textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="button"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="combobox"], [role="tab"]';

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

const NO_LOCAL_CHANNELS: ResultsBodyProps['filteredLocalChannels'] = [];

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
  // Opened on what was typed as Cmd+K grew into it (see TYPED_QUERY_STATE_KEY).
  const locationState: unknown = useLocation().state;
  const typedQuery = !!(locationState as Record<string, unknown> | null)?.[TYPED_QUERY_STATE_KEY];

  const [filters, setFilters] = useState<SearchResultsFilters>(() =>
    parseFiltersFromParams(searchParams),
  );

  // —— Search feedback popover ——
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const canPostFeedback = useCanPostSearchFeedback();

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
  // Match over every channel the user can read, not just the sidebar's visible set, so public
  // channels they haven't joined are found too; visible channels keep their sidebar data. Private
  // channels and DMs only when they are in them: an owner's client holds every channel in the
  // workspace, and this page never listed other members' private ones.
  // Each group ranked as cmdK ranks it (GlobalCommandMenu): by affinity, then recency — the order
  // its resting list shows and its ties keep. EMAIL/desk channels, which groupChannelsByScope
  // leaves to Desk, join the channels as they do there.
  const allChannelStatuses = useUserChannelStatuses();
  const affinityVersion = useAffinityCallback();
  const {
    starred: starredChannels,
    channels: regularChannels,
    directMessages: dmChannels,
  } = useMemo(() => {
    void affinityVersion;
    const visibleById = new Map(allChannels.map(channel => [channel.id, channel]));
    // A DM or group DM only ever when the user is in it: a public visibility on one (the channel
    // create API stores PUBLIC when none is given) must not list it to the rest of the workspace.
    const searchableChannels = allChannelsForNav
      .filter(
        channel =>
          visibleById.has(channel.id) ||
          (channel.visibility === ChannelVisibility.PUBLIC && !isDMChannel(channel.scopeType)),
      )
      .map(channel => visibleById.get(channel.id) ?? channel) as VisibleChannel[];
    const grouped = groupChannelsByScope(searchableChannels, allChannelStatuses);
    return {
      starred: rankChannelsByAffinity(grouped.starred),
      channels: rankChannelsByAffinity([
        ...grouped.channels,
        // Desk channels as before: from the full set, which visible channels never hold.
        ...allChannelsForNav
          .filter(channel => isDeskChannelType(channel.type))
          .map(channel => (visibleById.get(channel.id) ?? channel) as VisibleChannel),
      ]),
      directMessages: rankChannelsByAffinity(grouped.directMessages),
    };
  }, [allChannels, allChannelsForNav, allChannelStatuses, affinityVersion]);

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

  // Reuse this component's existing usersById + allUserGroups (no re-subscription) to resolve
  // each mention chip's display forms for result highlighting.
  const allUserGroups = useUserGroups();
  const userGroupsById = useMemo(
    () => new Map(allUserGroups.map(group => [group.id, group])),
    [allUserGroups],
  );
  const buildMentionHighlights = useMemo(
    () => makeMentionHighlightsBuilder(usersById, userGroupsById),
    [usersById, userGroupsById],
  );

  // The search box's text as of the last render, for the URL write below.
  const searchTextRef = useRef('');
  // The query this page last wrote to the URL itself (a finished search catching the address bar
  // up). It lands a render later, by when the user may have typed on: its arrival is not an
  // outside change, so it must not reset the box or the search to it.
  const ownQueryWriteRef = useRef<string | null>(null);
  // Use the exact same hook as the popup modal — no separate search infrastructure
  const {
    searchSessionId,
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
    setExcludeArchived,
    setExactMatch,
    setRankProfile,
    setStructuredFilters,
    setIncludeDebugInfo,
    loadMoreRef,
    paginationState,
    searchText: localSearchText,
    filteredLocalUsers,
    filteredLocalChannels,
    isLocalSearchPending,
    onOpen: onSessionOpen,
    onClose: onSessionClose,
    onResultClick,
  } = useSearchMetrics({
    surface: 'search_screen',
    // Opened from the palette with the query already chosen: nothing to debounce. Without one, or
    // on one still being typed, the first search is typing like any other (a filter-only search has
    // no text to skip for).
    immediateInitialSearch: !!query && !typedQuery,
    allChannels: allChannelsWithCategory,
    initialText: query,
    mentionSearchType: null,
    defaultOnlyMyChannels: filters.onlyMyChannels,
    // The Desk and Tickets tabs hide archived tickets by default; the "Show archived" toggle
    // turns exclusion off. Every other tab leaves archived untouched (flag stays false).
    defaultExcludeArchived:
      filters.docType === 'desk' || filters.docType === 'tickets' ? !filters.showArchived : false,
    groupByDocType: true,
    buildMentionHighlights,
    // The URL follows the results: the hook hands back the query these were fetched for,
    // so the address bar is shareable without anyone pressing Enter.
    onSearchComplete: (_results, searchedQuery) => {
      // Only while still on this page: a search that lands after the user has left (a collapse
      // mid-typing) would otherwise write its query onto whatever page they are on now.
      if (!isFullPageSearchPath(window.location.pathname)) return;
      // Nor a search the box has already moved on from — one whose debounce fired just as the
      // query changed (two quick toggles of exact match) — or it writes the old query back. The
      // hook reports the query with typed filters (status:, from:…) taken out, so the box is
      // compared the same way, but the URL gets what the box holds, filters and all.
      const boxText = searchTextRef.current.trim();
      if (searchedQuery.trim() !== parseSearchFilters(boxText).searchText.trim()) return;
      ownQueryWriteRef.current = boxText;
      handleQuerySubmitRef.current(boxText);
    },
  });
  searchTextRef.current = searchedText;

  // One search session per visit to this screen, for metrics. Mount-only via a ref (as in
  // ContextPicker): onClose closes over the session id, so its identity flips after onOpen
  // and would re-fire the effect if listed as a dep.
  const sessionRef = useRef({ onSessionOpen, onSessionClose });
  sessionRef.current = { onSessionOpen, onSessionClose };
  useEffect(() => {
    sessionRef.current.onSessionOpen('click');
    return (): void => sessionRef.current.onSessionClose();
  }, []);

  // The text the on-screen results actually reflect. Results update live as the user
  // types (the hook searches `searchedText`) but the URL `query` only commits on Enter,
  // so query-driven UI (empty-state copy, local-section gating) must read this, not the
  // stale URL param. Falls back to `query` on first paint before the sync effect runs.
  const displayQuery = searchedText.trim() || query;
  // Until the search workers answer, the people/channel lists are the unfiltered ones, which
  // must not be shown as results for `displayQuery`.
  const localResultsShown = isChannelsMode || filters.docType === 'all';
  const hasLocalQuery = !!localSearchText.trim();
  const localResultsReady = hasLocalQuery && !isLocalSearchPending;
  const localResultsPending = localResultsShown && hasLocalQuery && isLocalSearchPending;

  // Sync hook text whenever the URL query param changes; also close sidebar on new search
  const queryIsOwnWrite = ownQueryWriteRef.current === query;
  useEffect(() => {
    const ownWrite = ownQueryWriteRef.current === query;
    ownQueryWriteRef.current = null;
    if (!ownWrite) setText(query);
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

  // The URL's search state reaches the hook in layout effects: React applies their updates before
  // the hook's first search can fire, so an immediate first search (a carried query) is made
  // with the right tab, chips and filters rather than the hook's defaults.

  // Sync docType filter → hook active tab.
  // When from: is active with "all" tab, the Vespa from: filter is message-schema-only,
  // so restrict the hook to messages to get results. The UI still shows "All types".
  useLayoutEffect(() => {
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
  useLayoutEffect(() => {
    setIncludeBotMessages(filters.includeBotMessages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.includeBotMessages]);

  // Sync "only my channels" filter → hook (applied server-side via the onlyMyChannels flag)
  useLayoutEffect(() => {
    setOnlyMyChannels(filters.onlyMyChannels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.onlyMyChannels]);

  // Sync archived scope → hook. The Desk and Tickets tabs hide archived (and their "Show
  // archived" toggle opts back in); other tabs never exclude, matching pre-existing behavior.
  useLayoutEffect(() => {
    setExcludeArchived(
      filters.docType === 'desk' || filters.docType === 'tickets' ? !filters.showArchived : false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.docType, filters.showArchived]);

  // Sync exact-match → hook; the hook quotes the query when the request is built.
  useLayoutEffect(() => {
    setExactMatch(filters.exactMatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.exactMatch]);

  // Sync rankProfile filter → hook; clear selection so the matrix never mixes
  // ranking data captured under different profiles
  useLayoutEffect(() => {
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
  useLayoutEffect(() => {
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
  // Prefer the `@`-handle (alias), matching the cmd+K picker — else the same group chip reads
  // `@rockers` here but `@rock-team` in the popup.
  const mentionUserGroupName = useCallback(
    (id: string): string | undefined => {
      const group = userGroupsById.get(id);
      return group ? (group.alias ?? group.name) : undefined;
    },
    [userGroupsById],
  );
  const filterResolvers = useMemo(
    (): FilterResolvers => ({
      userName: mentionUserName,
      channelName: mentionChannelName,
      userGroupName: mentionUserGroupName,
      boardName,
    }),
    [mentionUserName, mentionChannelName, mentionUserGroupName, boardName],
  );

  // The active filter chips (from/to/with/in/assignee/priority + bare @/#), rebuilt only when a
  // chip-relevant filter changes. One build shared by the hook-sync effect and the save snapshot.
  const activeFilterChips = useMemo(
    () => buildChips({ ...filters, inChannelIds: channelIdsForSearch }, filterResolvers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      filters.fromUserIds,
      filters.fromEmails,
      filters.toEmails,
      channelIdsForSearch,
      filters.assigneeIds,
      filters.withUserIds,
      filters.mentionUserIds,
      filters.mentionChannelIds,
      filters.mentionUserGroupIds,
      filters.priority,
      mentionUserName,
      mentionChannelName,
      mentionUserGroupName,
    ],
  );

  // Sync the chip filters → the shared search hook.
  useLayoutEffect(() => {
    setSelectedMentions(activeFilterChips);
  }, [activeFilterChips, setSelectedMentions]);

  // Declared above the memo that uses it, so the callback is reached through a ref.
  const handleFiltersChangeRef = useRef<(next: SearchResultsFilters) => void>(() => undefined);
  // A new search — an edited query, a changed filter, a recent picked — starts the selection over:
  // a card hovered or arrowed to in the last one is not this one's pick, nor carried back to the
  // palette. Set once the selection exists (selectResult, below).
  const resetSelectionRef = useRef<() => void>(() => undefined);
  // handleQuerySubmit isn't declared where the hook options are built.
  const handleQuerySubmitRef = useRef<(next: string) => void>(() => undefined);

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

  // Always replaces: refining the search edits this screen, it doesn't navigate. Back
  // leaves the screen rather than walking every intermediate refinement.
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
      resetSelectionRef.current();
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

  // Collapse back into the Cmd+K modal, carrying the search as it stands on this page. The palette
  // shrinks down from here, over wherever the user expanded from.
  // One collapse at a time: a second click before the palette covers the page is ignored.
  const collapsingRef = useRef(false);
  // The selected result as it stands now (see paintSelection below), carried back on collapse,
  // and the one drawn as selected, which the arrow keys move on from.
  const selectedResultIdRef = useRef<string | null>(null);
  const shownResultIdRef = useRef<string | null>(null);
  // The search as it stands on this page, for the palette a collapse opens: this page's filters
  // (from its own router location — a Back has already moved the window's URL on), the text in its
  // search box (the URL only takes a query once a search for it finds something), and the
  // selection, so the palette opens on the result selected here.
  const locationSearchRef = useRef('');
  locationSearchRef.current = searchParams.toString();
  const searchToCarry = useCallback((): string => {
    const params = new URLSearchParams(locationSearchRef.current);
    const text = searchTextRef.current.trim();
    if (text) params.set('query', text);
    else params.delete('query');
    if (selectedResultIdRef.current) params.set(SELECTED_RESULT_PARAM, selectedResultIdRef.current);
    else params.delete(SELECTED_RESULT_PARAM);
    return `?${params.toString()}`;
  }, []);
  const handleCollapseToModal = (): void => {
    if (collapsingRef.current) return;
    collapsingRef.current = true;
    setTimeout(() => {
      collapsingRef.current = false;
    }, 1000);
    // Collapsing answers the snackbar's question, so it goes too.
    setAnnouncingFullPage(false);
    if (authContext.workspaceId && currentUserId) {
      recordCollapseToModal({
        workspaceId: authContext.workspaceId,
        userId: currentUserId,
        searchSessionId,
      });
    }
    // Full page never stays under the palette: back to where it expanded from, else the last page
    // outside full page, else the workspace's chat.
    const returnTo = takeFullPageOrigin() ?? {
      href: `/${authContext.workspaceId ?? ''}/chat`,
      historyIndex: null,
    };
    collapseToCmdk(searchToCarry(), returnTo);
  };

  // Editing the query in the header re-runs the search through the URL, the same path a
  // cmd+K search takes, so back/forward and the overlay's query restore keep working.
  // Filters live in their own params and are deliberately left untouched. Safe to write
  // separately: this runs from a user event, not alongside the combined effect above.
  /** Commit a query to the URL. Always replaces — see the sync effect above. */
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
          // The result carried over from the palette belonged to the old query.
          params.delete(SELECTED_RESULT_PARAM);
          return params;
        },
        { preventScrollReset: true, replace: true },
      );
    },
    [query, setSearchParams],
  );
  handleQuerySubmitRef.current = handleQuerySubmit;

  /**
   * Identity key of the last query saved as a recent. Opening several results from one search fires
   * the save on each click with the same query, so keying off this stores it once and skips the rest
   * until the query or its filters actually change.
   */
  const lastSavedKeyRef = useRef<string | null>(null);

  const saveCurrentSearchAsRecent = useCallback((): void => {
    const identityKey = identityKeyFor({ text: query, filterChips: activeFilterChips });
    if (identityKey === lastSavedKeyRef.current) return;
    lastSavedKeyRef.current = identityKey;

    saveCurrentSearchQuery(authContext.workspaceId ?? '', currentUserId, {
      text: query,
      filterChips: activeFilterChips,
      tab: docTypeToTabType(filters.docType),
      onlyMyChannels: filters.onlyMyChannels,
      includeBotMessages: filters.includeBotMessages,
    });
  }, [authContext.workspaceId, currentUserId, query, filters, activeFilterChips]);

  // Use filteredLocalChannels from the hook (same data pipeline as cmdK).
  // Guard against a missing or unanswered query so we never show the unfiltered channels.
  const readyLocalChannels = localResultsReady ? filteredLocalChannels : NO_LOCAL_CHANNELS;
  const localChannelResults = useMemo((): DisplaySearchResult[] => {
    if (!localResultsShown) return [];
    return readyLocalChannels.map(({ channel: c, searchableNames }) => {
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
  }, [localResultsShown, readyLocalChannels]);

  // Single "narrowing filter active" flag (from:/in:/assignee: + priority:, not the
  // onlyMyChannels scope toggle) — shared by result stripping and local-section suppression.
  const filtersActive = hasActiveFilters(filters) || !!filters.priority;

  // Tell a palette handing off to this page when the search for the URL query has settled, so it
  // lifts onto the real results rather than the placeholder list this page paints first.
  const sawSearchRef = useRef(false);
  useEffect(() => {
    if (!query && !narrowsSearch(filters)) {
      markFullPageReady();
      return;
    }
    if (isSearchPending || isLoading || localResultsPending) {
      sawSearchRef.current = true;
      return;
    }
    if (sawSearchRef.current) markFullPageReady();
  }, [query, filters, isSearchPending, isLoading, localResultsPending]);

  // Full page with nothing searched shows the palette's recents, the same list the modal shows.
  const recentSearches = useRecentSearches({
    open: true,
    enabled: !displayQuery && !filtersActive,
    workspaceId: authContext.workspaceId ?? '',
    userId: currentUserId ?? '',
    query: {
      text: '',
      filterChips: [],
      tab: TabType.ALL,
      onlyMyChannels: filters.onlyMyChannels,
      includeBotMessages: filters.includeBotMessages,
    },
  });
  // Choosing a recent runs it here, as choosing one in the modal fills and runs it there.
  // In place, as a submitted query is (handleQuerySubmit): a new search, not a step to go back to.
  const runRecent = (entry: RecentSearchEntry): void => {
    resetSelectionRef.current();
    setSearchParams(resultsParamsForQuery(entry), { replace: true });
  };
  const recentsContent =
    recentSearches.recents.length > 0 ? (
      // At rest nothing is highlighted: cmdk's value is pinned to a sentinel that matches no row
      // (as the palette does), so cmdk never marks its first row selected on its own.
      <Command
        shouldFilter={false}
        label='Recent searches'
        className='pt-2'
        value='__none__'
        onValueChange={() => undefined}
      >
        <Command.List>
          <RecentSearches
            recents={recentSearches.recents}
            currentUserID={currentUserId ?? ''}
            getTabLabel={tabLabel}
            onSelect={runRecent}
            onRemove={recentSearches.remove}
            onItemMouseDown={event => event.preventDefault()}
          />
        </Command.List>
      </Command>
    ) : null;

  // Nothing searched on the All tab shows what Cmd+K shows at rest, from the same channel list and
  // the same ranking: Starred, then the recents, then every other conversation by affinity.
  const browsing = !displayQuery && !narrowsSearch(filters) && filters.docType === 'all';
  const browseChannels = useMemo<BrowseChannels | null>(() => {
    void affinityVersion;
    if (!browsing) return null;
    const others = filteredLocalChannels.filter(
      ({ category }) => category !== ChannelCategory.STARRED,
    );
    return {
      starred: filteredLocalChannels.filter(({ category }) => category === ChannelCategory.STARRED),
      others: mergeRankedCandidates([toChannelCandidates(others, '')], MERGED_CANDIDATE_LIMIT).map(
        ({ item }) => item,
      ),
    };
  }, [browsing, filteredLocalChannels, affinityVersion]);

  // The result highlighted in the palette when it expanded, kept highlighted here.
  const carriedResultId = searchParams.get(SELECTED_RESULT_PARAM);

  // The selected result: starts on the carried one, follows the pointer and the arrows.
  const selectionRef = useRef<string | null>(carriedResultId);
  // The query box: the arrows and Enter it gets move and open the selection.
  const queryBoxRef = useRef<HTMLDivElement>(null);
  // What the drawing depends on besides the cards: nothing searched, and the search settled.
  const selectionContextRef = useRef({ browsing: false, settled: false });

  // Mobile has no arrows or pointer to move a selection with, so it shows none.
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;
  // Selection is painted in the DOM so pointer moves don't re-render; shown = selection if on page,
  // else first card once settled, none at rest. The selection itself is kept for the collapse.
  const paintSelection = useCallback((): void => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(`[${RESULT_CARD_ATTR}]`));
    const ids = cards.map(card => card.getAttribute(RESULT_CARD_ATTR));
    const selected = selectionRef.current;
    const { browsing: atRest, settled } = selectionContextRef.current;
    const previous = shownResultIdRef.current;
    let shown: string | null;
    if (isMobileRef.current) shown = null;
    else if (selected && ids.includes(selected)) shown = selected;
    else if (atRest) shown = null;
    else if (settled) shown = ids[0] ?? null;
    else shown = previous && ids.includes(previous) ? previous : null;
    shownResultIdRef.current = shown;
    selectedResultIdRef.current = selected ?? shown;
    cards.forEach(card => {
      if (card.getAttribute(RESULT_CARD_ATTR) === shown) {
        card.setAttribute('data-selected-result', 'true');
      } else {
        card.removeAttribute('data-selected-result');
      }
    });
  }, []);
  const selectResult = useCallback(
    (id: string | null): void => {
      if (selectionRef.current === id) return;
      selectionRef.current = id;
      paintSelection();
    },
    [paintSelection],
  );
  useEffect(() => selectResult(carriedResultId), [carriedResultId, selectResult]);
  resetSelectionRef.current = (): void => selectResult(null);

  // "Search now opens in full page" — owed on the first open after the default switched.
  const [announcingFullPage, setAnnouncingFullPage] = useState(false);
  useEffect(() => {
    if (!takeFullPageAnnouncement()) return;
    setAnnouncingFullPage(true);
    if (currentUserId) recordFullPageSnackbar(currentUserId, 'shown');
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back onto the palette's entry collapses with the stand-in (see watchBackFromFullPage), and
  // Cmd+K or Cmd+F here goes to this page's search box rather than opening the palette over it.
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  useEffect(() => {
    if (isMobile) return;
    const stopWatching = watchBackFromFullPage(searchToCarry);
    const onFocusRequest = (event: Event): void => {
      event.preventDefault();
      setSearchFocusRequest(count => count + 1);
    };
    window.addEventListener(FOCUS_FULL_PAGE_SEARCH_EVENT, onFocusRequest);
    return (): void => {
      stopWatching();
      window.removeEventListener(FOCUS_FULL_PAGE_SEARCH_EVENT, onFocusRequest);
    };
  }, [isMobile, searchToCarry]);

  selectionContextRef.current = {
    browsing,
    settled: !isSearchPending && !isLoading && !localResultsPending,
  };

  // ↑/↓ move the selection; Enter opens it only after the arrows were used (until then Enter in the
  // query box runs the search). An open typeahead keeps the arrows (it prevents them first).
  useEffect(() => {
    if (isMobile) return;
    let navigating = false;
    const cards = (): HTMLElement[] =>
      Array.from(document.querySelectorAll<HTMLElement>(`[${RESULT_CARD_ATTR}]`));
    const selectedCard = (list: HTMLElement[]): number =>
      list.findIndex(card => card.getAttribute(RESULT_CARD_ATTR) === shownResultIdRef.current);
    // The cards take the keys from the query input, the cards and the page itself; anything else
    // focused — a filter chip's ×, the Clear button, a menu, anything focusable by tabindex — keeps
    // its own, and so does the side panel: after a click in it (its text, with focus left on the
    // page) the arrows scroll it — while it is still open: closed (its ×, Esc), they are the
    // cards'.
    let pointerTarget: Element | null = null;
    const onPointerDown = (event: PointerEvent): void => {
      pointerTarget = event.target instanceof Element ? event.target : null;
    };
    const pointerInSidePanel = (): boolean =>
      !!pointerTarget?.isConnected && !!pointerTarget.closest(`[${SIDE_PANEL_ATTR}]`);
    const forTheCards = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return true;
      if (target === document.body || target === document.documentElement) {
        return !pointerInSidePanel();
      }
      if (target.id === FULL_PAGE_QUERY_INPUT_ID || target.closest(`[${RESULT_CARD_ATTR}]`)) {
        return true;
      }
      if (target.closest(`[${SIDE_PANEL_ATTR}]`) || target.hasAttribute('tabindex')) return false;
      return !target.closest(FOCUSABLE_CONTROL);
    };
    const ignored = (event: KeyboardEvent): boolean =>
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isDialogOpenOverPage() ||
      !forTheCards(event.target);
    // Capture, so Enter reaches here before the query box turns it into a search.
    const onEnter = (event: KeyboardEvent): void => {
      // An IME's Enter confirms the composition; it is not a pick.
      if (event.key !== 'Enter' || event.isComposing || !navigating || ignored(event)) return;
      // Focus moved into a card (Tab): Enter is for that card, not the arrows' pick — and a native
      // control inside it keeps its own Enter.
      const focusedCard =
        event.target instanceof Element ? event.target.closest(`[${RESULT_CARD_ATTR}]`) : null;
      if (focusedCard && (event.target as Element).closest('button, a[href], input, textarea')) {
        return;
      }
      const list = cards();
      const target = (focusedCard ?? list[selectedCard(list)])?.firstElementChild;
      if (!(target instanceof HTMLElement)) return;
      event.preventDefault();
      event.stopPropagation();
      target.click();
    };
    // Bubble, so an open typeahead in the query box gets the arrows first (it prevents them).
    const onArrow = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      if (event.defaultPrevented || ignored(event)) return;
      const list = cards();
      if (list.length === 0) return;
      const at = selectedCard(list);
      const next =
        event.key === 'ArrowDown' ? Math.min(list.length - 1, at + 1) : Math.max(0, at - 1);
      const card = list[next];
      if (!card) return;
      event.preventDefault();
      navigating = true;
      selectResult(card.getAttribute(RESULT_CARD_ATTR));
      card.scrollIntoView({ block: 'nearest' });
    };
    // Editing the query in any way (typing, Delete, a paste, IME) hands Enter back to the search,
    // and is a new search for the selection.
    const onQueryEdit = (event: Event): void => {
      if (event.target instanceof Element && queryBoxRef.current?.contains(event.target)) {
        navigating = false;
        selectResult(null);
      }
    };
    window.addEventListener('keydown', onEnter, true);
    window.addEventListener('keydown', onArrow);
    window.addEventListener('input', onQueryEdit, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return (): void => {
      window.removeEventListener('keydown', onEnter, true);
      window.removeEventListener('keydown', onArrow);
      window.removeEventListener('input', onQueryEdit, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [isMobile, selectResult]);

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
      const localUsers = localResultsReady ? filteredLocalUsers : [];
      const localUserResults: DisplaySearchResult[] = localUsers.map(user => ({
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
    localResultsReady,
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
  // Latest search key, read by async handlers to drop panels that resolve after a re-search.
  const fullSearchKeyRef = useRef(fullSearchKey);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query]);

  // Close any open panel and refresh the async race key whenever the search or filters change
  useEffect(() => {
    fullSearchKeyRef.current = fullSearchKey;
    setSelectedPanel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullSearchKey]);

  // The save lives on the two message-open handlers (thread + message context), not the card
  // click, because every message-open affordance (body, keyboard, reply button) converges here.
  const handleSelectThread = useCallback(
    (thread: SearchResultsThread) => {
      saveCurrentSearchAsRecent();
      setSelectedPanel({ kind: 'thread', thread });
    },
    [saveCurrentSearchAsRecent],
  );
  const handleSelectUser = useCallback((userId: string) => {
    setSelectedPanel({ kind: 'profile', userId });
  }, []);
  const handleSelectMessageContext = useCallback(
    (
      channelId: string,
      conversationId: string,
      conversationCreatedAt?: number,
      matchedMessageId?: string | null,
    ) => {
      saveCurrentSearchAsRecent();
      setSelectedPanel({
        kind: 'channel',
        channelId,
        conversationId,
        ...(conversationCreatedAt !== undefined && { conversationCreatedAt }),
        matchedMessageId: matchedMessageId ?? null,
      });
    },
    [saveCurrentSearchAsRecent],
  );
  // Open a user's 1:1 DM chat in the right pane, creating the DM if it doesn't exist.
  // Async; drops the result if the search changed while the DM was being created.
  const openUserDm = useCallback(
    (userId: string): void => {
      const keyAtClick = fullSearchKeyRef.current;
      void (async (): Promise<void> => {
        try {
          const channelId = await resolveOrCreateDmChannelId(
            userId,
            allChannelsForNav,
            currentUserId,
          );
          if (fullSearchKeyRef.current !== keyAtClick) return;
          setSelectedPanel({ kind: 'channel', channelId });
        } catch {
          toast.error('Failed to open conversation');
        }
      })();
    },
    [allChannelsForNav, currentUserId],
  );
  // Metrics for a result open. `rank` is the card's 1-indexed position within its section,
  // the same meaning cmdK's rankPosition has. Message cards open through context handlers
  // rather than openResult, so they call this directly.
  const trackResultClick = useCallback(
    (result: DisplaySearchResult, rank: number): void => {
      onResultClick(result, rank, result.searchContext?.channelId);
    },
    [onResultClick],
  );
  // Single entry point for a result-card click: resolve what it should do, then do it.
  const openResult = useCallback(
    (result: DisplaySearchResult, rank: number): void => {
      const action = resolveResultClick(result, allChannelsForNav);
      if (!action) return;
      trackResultClick(result, rank);
      // Recents capture content searches — opening a person or channel is navigation, not a query to replay.
      if (result.type !== 'user' && result.type !== 'channel') saveCurrentSearchAsRecent();
      switch (action.kind) {
        case 'panel':
          setSelectedPanel(action.panel);
          return;
        case 'navigate':
          void navigate(action.to, action.state ? { state: action.state } : undefined);
          return;
        case 'userDm':
          openUserDm(action.userId);
          return;
      }
    },
    [allChannelsForNav, navigate, openUserDm, saveCurrentSearchAsRecent, trackResultClick],
  );
  const handleClosePanel = (): void => {
    setSelectedPanel(null);
  };

  const contextValue = useMemo(
    () => ({
      onSelectThread: handleSelectThread,
      onSelectUser: handleSelectUser,
      onSelectMessageContext: handleSelectMessageContext,
      onResultOpen: saveCurrentSearchAsRecent,
    }),
    [handleSelectThread, handleSelectUser, handleSelectMessageContext, saveCurrentSearchAsRecent],
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

  /** True when the search returned results. Controls the result count and Compare button. */
  const hasResultsRow = results.length > 0 || (!!query && totalCount > 0);

  // Filter labels sent with feedback.
  const feedbackFilters = useMemo(
    () => buildFilterSummary(filters, filterResolvers, query),
    [filters, filterResolvers, query],
  );

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
          <div ref={queryBoxRef} className='flex-1 min-w-0'>
            <SearchQueryInput
              query={query}
              queryIsOwnWrite={queryIsOwnWrite}
              tokens={queryTokens}
              filters={filters}
              onFiltersChange={handleFiltersChange}
              onSubmit={handleQuerySubmit}
              onLiveChange={setText}
              isSearching={isLoading}
              autoFocus={!isMobile}
              focusRequest={searchFocusRequest}
            />
          </div>
          {!isMobile && (
            <div className='relative shrink-0'>
              <Tooltip content={<span>Collapse to modal</span>} side='bottom'>
                <button
                  type='button'
                  aria-label='Collapse to modal'
                  onPointerEnter={drawPageUnderFullPage}
                  onClick={handleCollapseToModal}
                  className='size-7 shrink-0 flex items-center justify-center rounded-[10px] border border-border transition-colors text-sidebar-secondary-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent'
                  data-track-category='SEARCH_RESULTS'
                  data-track-name='COLLAPSE_TO_MODAL'
                >
                  <Minimize2 size={14} />
                </button>
              </Tooltip>
              {announcingFullPage && (
                <FullPageSnackbar
                  onUndo={() => {
                    setAnnouncingFullPage(false);
                    if (authContext.workspaceId && currentUserId) {
                      recordUndoFullPageDefault({
                        workspaceId: authContext.workspaceId,
                        userId: currentUserId,
                      });
                    }
                  }}
                  onDismiss={() => {
                    setAnnouncingFullPage(false);
                    if (currentUserId) recordFullPageSnackbar(currentUserId, 'dismissed');
                  }}
                />
              )}
            </div>
          )}
        </div>
        <div className='mt-3'>
          <SearchFilterBar
            filters={filters}
            onFiltersChange={handleFiltersChange}
            query={query}
            onQueryChange={handleQuerySubmit}
          />
        </div>
        {/* Shown for any query or active filter so Feedback is available even with no results.
            The result count and Compare still need results. */}
        {(hasResultsRow || (canPostFeedback && (!!displayQuery || filtersActive))) && (
          <div className='flex items-center justify-between gap-3 pb-2'>
            {hasResultsRow && (
              <p className='text-xs text-muted-foreground tabular-nums'>
                {(totalCount || results.length).toLocaleString()} results
              </p>
            )}
            <div className='flex items-center gap-2 ml-auto'>
              {canPostFeedback && (
                <SearchFeedbackPopover
                  open={feedbackOpen}
                  onOpenChange={setFeedbackOpen}
                  query={displayQuery}
                  filters={feedbackFilters}
                  sort={sortSummary(filters)}
                >
                  <button
                    title='Tell the search team about these results'
                    data-track-category='SEARCH_RESULTS'
                    data-track-name='OPEN_FEEDBACK'
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md active:scale-[0.96] transition',
                      feedbackOpen
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border',
                    )}
                  >
                    <MessageSquare size={13} />
                    Feedback
                  </button>
                </SearchFeedbackPopover>
              )}
              {hasResultsRow && (
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
              )}
            </div>
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
            searchedByFilter={narrowsSearch(filters)}
            isSearchPending={isSearchPending}
            isLocalSearchPending={localResultsPending}
            isLoading={isLoading}
            error={error}
            results={results}
            loadMoreRef={loadMoreRef}
            selectedPanel={selectedPanel}
            onOpenResult={openResult}
            onTrackResultClick={trackResultClick}
            channelData={allChannelsForNav}
            searchableChannels={allChannelsWithCategory}
            usersById={usersById}
            compareMode={compareMode}
            isGrouped={isGrouped}
            selectedIds={selectedIds}
            relevantIds={relevantIds}
            onToggleSelect={toggleSelect}
            docType={filters.docType}
            filteredLocalChannels={readyLocalChannels}
            emptyQueryContent={recentsContent}
            browseChannels={browseChannels}
            highlightId={carriedResultId}
            paintSelection={paintSelection}
            onSelectResult={selectResult}
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

type LocalChannelItem = ResultsBodyProps['filteredLocalChannels'][number];

/** Cmd+K's resting conversations: Starred, and the rest in its People & channels order. */
interface BrowseChannels {
  starred: LocalChannelItem[];
  others: LocalChannelItem[];
}

const BROWSE_SECTION = 'browse-people-channels';

interface ResultsBodyProps {
  /** Shown in place of the "Type to search" state when nothing is searched (the recents). */
  emptyQueryContent?: ReactElement | null;
  /** Nothing searched on the All tab: the conversations Cmd+K lists around the recents. */
  browseChannels?: BrowseChannels | null;
  /** A result carried over from the palette: scrolled into view, and its section opened. */
  highlightId?: string | null;
  /** Draws the selected result on the cards; run whenever they render. */
  paintSelection?: () => void;
  onSelectResult?: (id: string) => void;
  query: string;
  /** The text the visible results reflect (live typed text, falling back to the URL
   *  query). Drives empty-state copy and local-section gating so they track live typing. */
  displayQuery: string;
  hasActiveFilters: boolean;
  /** A filter of any kind narrows the search: with nothing typed, there is still a search. */
  searchedByFilter: boolean;
  isSearchPending: boolean;
  /** The local people/channel matches haven't caught up with the query yet. */
  isLocalSearchPending: boolean;
  isLoading: boolean;
  error: string | null;
  results: DisplaySearchResult[];
  loadMoreRef: React.RefObject<HTMLDivElement | null>;
  selectedPanel: SidePanelState;
  onOpenResult: (result: DisplaySearchResult, rank: number) => void;
  onTrackResultClick: (result: DisplaySearchResult, rank: number) => void;
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
      <Avatar userId={result.id} size='md' showActiveStatus />
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
  searchedByFilter,
  isSearchPending,
  isLocalSearchPending,
  isLoading,
  error,
  results,
  loadMoreRef,
  selectedPanel,
  onOpenResult,
  onTrackResultClick,
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
  emptyQueryContent,
  browseChannels,
  highlightId,
  paintSelection,
  onSelectResult,
}: ResultsBodyProps): ReactElement {
  // Every render can add or replace cards; the selection is drawn on them before they paint.
  useLayoutEffect(() => paintSelection?.());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  // Bring the carried result into view once it has rendered — once per carried id, so a re-render
  // never yanks the list back while the user scrolls.
  const scrolledToRef = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightId || scrolledToRef.current === highlightId) return;
    const card = document.querySelector(`[${RESULT_CARD_ATTR}="${CSS.escape(highlightId)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'nearest' });
    scrolledToRef.current = highlightId;
  });
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

  // A section holding the carried result opens for it, once: "See less" still closes it.
  const [carryClosed, setCarryClosed] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => setCarryClosed(new Set()), [highlightId]);
  const sectionExpanded = (key: string, holdsCarried: boolean): boolean =>
    expandedCategories.has(key) || (holdsCarried && !carryClosed.has(key));
  const toggleSection = (key: string, expanded: boolean): void => {
    if (expanded) setCarryClosed(prev => new Set(prev).add(key));
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (expanded) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Renders a single result card — shared between flat and grouped views
  // `resultIndex` is the 0-based rank of this card within its section (the whole list in the
  // flat view). It is the whole search-quality signal — mean click rank and click-through by
  // position are uncomputable without it — so it rides down to the tracked elements and is the
  // rank every click reports, matching cmdK's per-section rankPosition.
  // Every card sits in a wrapper that carries its id and selected state (data-selected-result,
  // drawn by paintSelection and styled in global.css), so the selection reads the same on every
  // card type, and the pointer moves it as in the palette.
  const renderCard = (result: DisplaySearchResult, resultIndex: number): ReactElement | null => {
    const card = renderResultCard(result, resultIndex);
    if (!card) return card;
    return (
      <div
        key={card.key}
        {...{ [RESULT_CARD_ATTR]: result.id }}
        // The pointer moving onto a card selects it — moving, not resting: the browser also sends
        // still mouse-moves when the list shifts under a resting pointer (an arrow scrolling it),
        // which must not take the selection back from the keys.
        onMouseMove={(event): void => {
          if (event.movementX !== 0 || event.movementY !== 0) onSelectResult?.(result.id);
        }}
      >
        {card}
      </div>
    );
  };

  const renderResultCard = (
    result: DisplaySearchResult,
    resultIndex: number,
  ): ReactElement | null => {
    const key = `${result.type}-${result.id}`;
    const rank = resultIndex + 1;

    // User card — opens the user's DM chat in the right pane.
    if (result.type === 'user') {
      return (
        <UserResultCard key={key} result={result} onSelectUser={() => onOpenResult(result, rank)} />
      );
    }

    // Channel card
    if (result.type === 'channel') {
      const channelId = result.searchContext?.channelId ?? result.id;
      const channel = channelData?.find(c => c.id === channelId);
      const isDeskChannel = isDeskChannelType(channel?.type);
      return (
        <button
          key={key}
          onClick={() => onOpenResult(result, rank)}
          className='w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left'
          data-track-category='SEARCH_RESULTS'
          data-track-name={isDeskChannel ? 'OPEN_DESK_CHANNEL' : 'OPEN_CHANNEL'}
        >
          <div className='flex items-center justify-center size-9 rounded-lg bg-muted shrink-0'>
            <ChannelIcon channel={channel} glyphClassName='text-muted-foreground' avatarSize='md' />
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
          onClick={() => onOpenResult(result, rank)}
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
          onClick={() => onOpenResult(result, rank)}
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
            {/* Assignee of the linked desk ticket, when set — same muted style as the
                sender line above (mirrors the cmdK desk row). */}
            {result.searchContext?.assigneeName && (
              <span className='block min-w-0 truncate text-xs text-muted-foreground'>
                {`Assigned to ${result.searchContext.assigneeName}`}
              </span>
            )}
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

    // Tickets render as a compact data-driven ticket card. Desk tickets navigate to
    // the support view; board tickets open their details in the right pane. Rendering
    // both as TicketCardV2 (single onClick) avoids the message-bubble's embedded ticket
    // widget fighting the card click for board tickets.
    if (isTicket && ticketSummary) {
      // The wrapper opens it — the card's own button bubbles here — so Enter, which activates a
      // card's first element, opens tickets too. Presentational: it only catches that bubbled
      // click.
      return (
        <div
          key={key}
          role='presentation'
          className='w-full'
          onClick={() => onOpenResult(result, rank)}
          data-track-category='SEARCH_RESULTS'
          data-track-name='OPEN_DESK_TICKET_RESULT'
        >
          <TicketCardV2 ticket={ticketSummary} isConversation width='max-w-none w-full' />
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
        resultIndex={resultIndex}
        onOpen={() => onTrackResultClick(result, rank)}
        resultCount={results.length}
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
      sectionKey: string,
      items: typeof filteredLocalChannels,
      collapsible = true,
      limit = LOCAL_SECTION_DISPLAY_LIMIT,
      label = CATEGORY_LABELS[sectionKey],
    ): ReactElement | null => {
      if (items.length === 0) return null;
      // A result carried over from the palette is never left behind "See more".
      const holdsCarried =
        !!highlightId && items.slice(limit).some(({ channel: c }) => c.id === highlightId);
      const isExpanded = sectionExpanded(sectionKey, holdsCarried);
      const hasMore = collapsible && items.length > limit;
      const displayItems = !isExpanded && hasMore ? items.slice(0, limit) : items;
      const hiddenCount = items.length - limit;
      return (
        <div key={sectionKey} className='mb-6'>
          <p className='px-1 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide font-mono'>
            {label}
          </p>
          <div className='space-y-2'>
            {displayItems.map(({ channel: c, searchableNames }, i) =>
              renderCard(toChannelResult(c, searchableNames), i),
            )}
          </div>
          {hasMore && (
            <button
              onClick={() => toggleSection(sectionKey, isExpanded)}
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
      const isExpanded = sectionExpanded(
        'user',
        !!highlightId &&
          userResults.slice(LOCAL_SECTION_DISPLAY_LIMIT).some(user => user.id === highlightId),
      );
      const hasMore = userResults.length > LOCAL_SECTION_DISPLAY_LIMIT;
      const displayItems =
        !isExpanded && hasMore ? userResults.slice(0, LOCAL_SECTION_DISPLAY_LIMIT) : userResults;
      const hiddenCount = userResults.length - LOCAL_SECTION_DISPLAY_LIMIT;
      return (
        <div key='user' className='mb-6'>
          <p className='px-1 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide font-mono'>
            Users ({userResults.length})
          </p>
          <div className='space-y-2'>{displayItems.map((result, i) => renderCard(result, i))}</div>
          {hasMore && (
            <button
              onClick={() => toggleSection('user', isExpanded)}
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

    // Nothing searched: Cmd+K's resting list — Starred (fewer while recents show), the recents,
    // then People & channels.
    if (
      !displayQuery &&
      !hasActiveFilters &&
      browseChannels &&
      (browseChannels.starred.length > 0 || browseChannels.others.length > 0)
    ) {
      return (
        <div className='w-full pt-2 pb-6'>
          {renderLocalChannelSection(
            ChannelCategory.STARRED,
            browseChannels.starred,
            true,
            emptyQueryContent ? RECENTS_STARRED_CAP : LOCAL_SECTION_DISPLAY_LIMIT,
          )}
          {emptyQueryContent && <div className='mb-6'>{emptyQueryContent}</div>}
          {renderLocalChannelSection(
            BROWSE_SECTION,
            browseChannels.others,
            true,
            MERGED_DISPLAY_LIMIT,
            `People & channels (${browseChannels.others.length})`,
          )}
        </div>
      );
    }

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
      if (!displayQuery && !searchedByFilter) {
        return (
          emptyQueryContent ?? (
            <EmptyState title='Search for messages, files, and tickets' subtitle='Type to search' />
          )
        );
      }
      // isSearchPending is primary (race-proof); isLoading backstops a real in-flight fetch.
      if (isLoading || isSearchPending || isLocalSearchPending) {
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
                  {grouped.get(gk)!.map((result, i) => renderCard(result, i))}
                </div>
              </div>
            ))
          : backendOnly.length > 0 && (
              <div className='mb-6'>
                <p className='px-1 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide font-mono'>
                  {GROUP_LABELS['others']} ({backendOnly.length})
                </p>
                <div className='space-y-2'>
                  {backendOnly.map((result, i) => renderCard(result, i))}
                </div>
              </div>
            )}
        {footer}
      </div>
    );
  }

  // ── Flat view — specific docType tabs and compare mode ──────────────────
  if (results.length === 0) {
    if (!displayQuery && !searchedByFilter) {
      return (
        emptyQueryContent ?? (
          <EmptyState title='Search for messages, files, and tickets' subtitle='Type to search' />
        )
      );
    }
    // isSearchPending is primary (race-proof); isLoading backstops a real in-flight fetch.
    if (isLoading || isSearchPending || isLocalSearchPending) {
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
        const el = renderCard(result, index);
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
        <div
          {...{ [SIDE_PANEL_ATTR]: '' }}
          className='absolute inset-0 z-20 bg-background flex flex-col animate-slide-in-from-right'
        >
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

// Default pane split when a side panel is open. Desk tickets render a 3-column ticket view
// (email thread + details/AI sidebar), so they open wider than other panes.
const RESULTS_SIZE_FULL = '100%'; // no panel open
const RESULTS_SIZE_WITH_PANEL = '55%';
const RESULTS_MIN_SIZE = '30%';
const SIDE_PANEL_SIZE = '45%';
const SIDE_PANEL_MIN_SIZE = '25%';

// Layout persistence key (ResizableGroup autoSaveId → localStorage). One split for every panel type —
// a single consistent side-panel width avoids the results list reflowing when switching result types.
const PANE_LAYOUT_ID = 'search-results-panel';

function DesktopLayout({ selectedPanel, onClose, resultsColumn }: LayoutProps): ReactElement {
  return (
    <ResizableGroup
      orientation='horizontal'
      className='h-full'
      autoSaveId={PANE_LAYOUT_ID}
      panelIds={selectedPanel ? ['search-results', 'search-side-panel'] : ['search-results']}
    >
      <Panel
        id='search-results'
        defaultSize={selectedPanel ? RESULTS_SIZE_WITH_PANEL : RESULTS_SIZE_FULL}
        minSize={selectedPanel ? RESULTS_MIN_SIZE : RESULTS_SIZE_FULL}
      >
        <div className='h-full'>{resultsColumn}</div>
      </Panel>
      {selectedPanel && (
        <>
          <Separator className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
            <div className='w-[1px] h-full bg-border' />
          </Separator>
          <Panel id='search-side-panel' defaultSize={SIDE_PANEL_SIZE} minSize={SIDE_PANEL_MIN_SIZE}>
            <div {...{ [SIDE_PANEL_ATTR]: '' }} className='h-full animate-slide-in-from-right'>
              <SearchResultsSidePanel panel={selectedPanel} onClose={onClose} />
            </div>
          </Panel>
        </>
      )}
    </ResizableGroup>
  );
}

// Side-panel rendering, click resolution, and panel types now live in ./SidePanel
// (SidePanel, ResultClickResolver, PanelTypes).
