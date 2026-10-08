import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchService } from '../services/searchService';
import type { VespaSearchFilters, DisplaySearchResult } from '../types/search';
import type { Ticket } from '@xyne/shared';
import { TicketPriority, TicketStatusV2 } from '@xyne/shared';
import { useCmdkDefaultRankProfiles } from './useCmdkSearchConfig';

// Filter-only matches fetched per request (the backend's max page).
const MAX_VESPA_TICKET_SEARCH_LIMIT = 400;
const FILTER_ONLY_DYNAMIC_FIELD_CACHE_TTL_MS = 30_000;
const SEARCH_DEBOUNCE_MS = 300;

interface UseVespaTicketSearchParams {
  projectId?: string;
  boardId?: string;
  status?: string;
  stage?: string;
  priority?: string;
  assignee?: string;
  tags?: string;
  createdBy?: string;
  userGroup?: string;
  dynamicFieldValues?: string[];
  dynamicFieldDateRanges?: Record<string, { start?: number; end?: number }>;
  enabled?: boolean;
}

interface UseVespaTicketSearchResult {
  searchResults: Ticket[] | null;
  isSearching: boolean;
}

const EMPTY_DYNAMIC_FIELD_VALUES: string[] = [];

type VespaTicketSearchResponse = Awaited<ReturnType<typeof searchService.vespaSearch>>;

const filterOnlyDynamicFieldCache = new Map<
  string,
  { expiresAt: number; results: DisplaySearchResult[] }
>();
const filterOnlyDynamicFieldInflight = new Map<string, Promise<DisplaySearchResult[]>>();

const getFilterOnlyDynamicFieldCacheKey = (filters: VespaSearchFilters): string =>
  JSON.stringify({
    query: filters.query,
    type: filters.type,
    apps: filters.apps,
    projectId: filters.projectId ?? null,
    board: filters.board ?? null,
    status: filters.status ?? null,
    stage: filters.stage ?? null,
    priority: filters.priority ?? null,
    assignee: filters.assignee ?? null,
    tags: filters.tags ?? null,
    from: filters.from ?? null,
    dynamicFieldValues: filters.dynamicFieldValues ?? null,
    dynamicFieldDateRanges: filters.dynamicFieldDateRanges
      ? Object.entries(filters.dynamicFieldDateRanges).sort(([left], [right]) =>
          left.localeCompare(right),
        )
      : null,
    filterOnly: filters.filterOnly ?? null,
    limit: filters.limit ?? null,
  });

/** One filter-only request per filter set: cached briefly and shared while in flight. */
const fetchFilterOnlyResults = async (
  vespaFilters: VespaSearchFilters,
): Promise<DisplaySearchResult[]> => {
  const cacheKey = getFilterOnlyDynamicFieldCacheKey(vespaFilters);
  const cached = filterOnlyDynamicFieldCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.results;
  }

  const inflight = filterOnlyDynamicFieldInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const request = (async (): Promise<DisplaySearchResult[]> => {
    const response: VespaTicketSearchResponse = await searchService.vespaSearch(vespaFilters);
    filterOnlyDynamicFieldCache.set(cacheKey, {
      expiresAt: Date.now() + FILTER_ONLY_DYNAMIC_FIELD_CACHE_TTL_MS,
      results: response.results,
    });
    return response.results;
  })();

  filterOnlyDynamicFieldInflight.set(cacheKey, request);

  try {
    return await request;
  } finally {
    filterOnlyDynamicFieldInflight.delete(cacheKey);
  }
};

export const stripHighlightMarkup = (value: string | undefined): string =>
  value?.replace(/<\/?hi>/gi, '') ?? '';

function toTicket(r: DisplaySearchResult): Ticket {
  const ctx = r.searchContext ?? {};
  return {
    id: r.id,
    title: stripHighlightMarkup(r.title),
    description: stripHighlightMarkup(r.context),
    status: '' as never,
    statusV2: (ctx.ticketStatus as TicketStatusV2) ?? TicketStatusV2.TODO,
    priority: (ctx.priority as TicketPriority) ?? TicketPriority.MEDIUM,
    stageName: ctx.stageName ?? '',
    boardId: ctx.boardId ?? '',
    projectId: ctx.projectId ?? '',
    channelId: ctx.channelId ?? '',
    conversationId: ctx.conversationId ?? '',
    xyneId: ctx.xyneId ?? '',
    assignedTo: ctx.assignedTo ?? '',
    createdBy: ctx.createdBy ?? '',
    updatedBy: '',
    createdAt: ctx.createdAtTimestamp ?? 0,
    updatedAt: 0,
    statusUpdatedAt: 0,
    workspaceId: '',
    userGroupId: ctx.userGroupId ?? '',
    tags: (ctx.tags ?? []).map(tag => ({
      id: `${r.id}:${tag}`,
      ticketId: r.id,
      name: tag,
      workspaceId: '',
      createdAt: 0,
      updatedAt: 0,
    })),
    ticketType: ctx.ticketType ?? null,
    isArchived: false,
    kanbanPosition: null,
    lastEmailAt: 0,
    emailCount: null,
    merchantId: null,
    eta: null,
    metadata: null,
    closedAt: null,
    closedBy: null,
    classificationData: null,
    aiCategory: null,
    aiSubCategory: null,
    aiPriority: null,
    firstRespondedAt: null,
    emailReplyEnabled: false,
  } as unknown as Ticket;
}

/**
 * The tickets matching the board's custom-field filters, fetched from Vespa as a filter-only
 * search (every match, up to MAX_VESPA_TICKET_SEARCH_LIMIT), together with the other filters
 * Vespa can express. Null while no custom-field filter is set. Requests are cached and shared
 * by filters, so the columns of one board make one call.
 */
export const useVespaTicketSearch = ({
  projectId,
  boardId,
  status,
  stage,
  priority,
  assignee,
  tags,
  createdBy,
  userGroup,
  dynamicFieldValues = EMPTY_DYNAMIC_FIELD_VALUES,
  dynamicFieldDateRanges = {},
  enabled = true,
}: UseVespaTicketSearchParams): UseVespaTicketSearchResult => {
  const [searchResults, setSearchResults] = useState<Ticket[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const defaultRankProfileFor = useCmdkDefaultRankProfiles();
  const rankProfile = defaultRankProfileFor('tickets');

  const dynamicFieldValuesKey = dynamicFieldValues.join('\u001f');
  const normalizedDynamicFieldValues = useMemo(
    () =>
      dynamicFieldValuesKey ? dynamicFieldValuesKey.split('\u001f') : EMPTY_DYNAMIC_FIELD_VALUES,
    [dynamicFieldValuesKey],
  );
  const dynamicFieldDateRangesKey = JSON.stringify(
    Object.entries(dynamicFieldDateRanges).sort(([left], [right]) => left.localeCompare(right)),
  );
  const normalizedDynamicFieldDateRanges = useMemo(() => {
    if (!dynamicFieldDateRangesKey) return {};

    const entries = Object.entries(dynamicFieldDateRanges)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fieldId, range]) => {
        const normalizedRange: { start?: number; end?: number } = {};
        if (range.start !== undefined) normalizedRange.start = range.start;
        if (range.end !== undefined) normalizedRange.end = range.end;
        return [fieldId, normalizedRange] as const;
      });

    return Object.fromEntries(entries) as Record<string, { start?: number; end?: number }>;
  }, [dynamicFieldDateRangesKey]);
  const hasDynamicFieldFilters =
    normalizedDynamicFieldValues.length > 0 ||
    Object.keys(normalizedDynamicFieldDateRanges).length > 0;

  const performSearch = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const vespaFilters: VespaSearchFilters = {
      query: '*',
      type: 'tickets',
      apps: 'ticket',
      limit: MAX_VESPA_TICKET_SEARCH_LIMIT,
      rankProfile,
      filterOnly: true,
    };
    if (projectId) vespaFilters.projectId = projectId;
    if (boardId) vespaFilters.board = boardId;
    if (status) vespaFilters.status = status;
    if (stage) vespaFilters.stage = stage;
    if (priority) vespaFilters.priority = priority;
    if (assignee) vespaFilters.assignee = assignee;
    if (tags) vespaFilters.tags = tags;
    if (createdBy) vespaFilters.from = createdBy;
    if (userGroup) vespaFilters.userGroup = userGroup;
    if (normalizedDynamicFieldValues.length > 0) {
      vespaFilters.dynamicFieldValues = normalizedDynamicFieldValues;
    }
    if (Object.keys(normalizedDynamicFieldDateRanges).length > 0) {
      vespaFilters.dynamicFieldDateRanges = normalizedDynamicFieldDateRanges;
    }

    try {
      const results = await fetchFilterOnlyResults(vespaFilters);
      if (!abortController.signal.aborted) {
        setSearchResults(results.map(toTicket));
      }
    } catch {
      if (!abortController.signal.aborted) {
        setSearchResults(null);
      }
    } finally {
      if (!abortController.signal.aborted) {
        setIsSearching(false);
      }
    }
  }, [
    projectId,
    boardId,
    status,
    stage,
    priority,
    assignee,
    tags,
    createdBy,
    userGroup,
    normalizedDynamicFieldValues,
    normalizedDynamicFieldDateRanges,
    rankProfile,
  ]);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (!enabled || !hasDynamicFieldFilters) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    debounceTimerRef.current = setTimeout(() => {
      void performSearch();
    }, SEARCH_DEBOUNCE_MS);

    return (): void => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [enabled, hasDynamicFieldFilters, performSearch]);

  useEffect(() => {
    return (): void => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return { searchResults, isSearching };
};
