import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ticket } from '@xyne/shared';
import { useCachedQuery } from '@xyne/shared/hooks';
import { queries, parseAssigneeFilter } from '../../zero/queries';
import { useVespaTicketSearch } from '../../hooks/useVespaTicketSearch';
import { withTicketChannelScope } from './ticketChannelScope';
import {
  getDynamicFieldScalarFilters,
  getFormFieldValue,
  toQueryFilters,
  type KanbanTicketsPageRow,
  type KanbanTicketsPageBaseArgs,
} from './useKanbanTicketsPage';

/**
 * Cursor paging for the table list view: one group per hook instance, pages
 * from `tableTicketsPage`, with a chunked `ticketsByIds` overlay keeping
 * loaded rows live (edits patch in, rows that left the group are evicted).
 */

export type UseTableTicketsPageOptions = Omit<KanbanTicketsPageBaseArgs, 'vespaTicketIds'> & {
  enabled?: boolean;
  pageSize?: number;
};

export interface UseTableTicketsPageResult {
  tickets: KanbanTicketsPageRow[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  isSearchMode: boolean;
}

const DEFAULT_PAGE_SIZE = 50;
const OVERLAY_CHUNK_SIZE = 100;
const OVERLAY_CHUNKS = 10;

const ceilToMinute = (timestamp: number): number => Math.ceil(timestamp / 60000) * 60000;

type PageCursor = { createdAt: number; id: string };

type TicketsState = { queryKey: string; tickets: KanbanTicketsPageRow[] };

const EMPTY_IDS: string[] = [];

/** Mirrors tableTicketsPage's group predicate — used to evict moved rows. */
const rowMatchesGroup = (
  row: Ticket,
  groupBy: UseTableTicketsPageOptions['groupBy'],
  groupKey: string | undefined,
): boolean => {
  if (!groupBy || groupBy === 'none' || !groupKey) return true;
  if (groupBy === 'assignee') {
    return groupKey === 'Unassigned' ? !row.assignedTo : row.assignedTo === groupKey;
  }
  if (groupBy === 'createdBy') return row.createdBy === groupKey;
  if (groupBy === 'status') return (row.statusV2 as string) === groupKey;
  if (groupBy === 'priority') return (row.priority as string) === groupKey;
  if (groupBy === 'merchantId') {
    return groupKey === 'No Merchant' ? !row.merchantId : row.merchantId === groupKey;
  }
  return true;
};

export const useTableTicketsPage = (
  options: UseTableTicketsPageOptions,
): UseTableTicketsPageResult => {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const enabled = options.enabled ?? true;
  const [ticketsState, setTicketsState] = useState<TicketsState>({ queryKey: '', tickets: [] });
  const [cursorState, setCursorState] = useState<{ queryKey: string; cursor: PageCursor } | null>(
    null,
  );
  const [hasMore, setHasMore] = useState(true);
  const isLoadingMoreRef = useRef(false);
  const ticketsStateRef = useRef<TicketsState>({ queryKey: '', tickets: [] });
  ticketsStateRef.current = ticketsState;

  const overdueReferenceTimeRef = useRef<number | null>(null);
  if (options.showOverdueOnly && overdueReferenceTimeRef.current === null) {
    overdueReferenceTimeRef.current = options.overdueReferenceTime ?? ceilToMinute(Date.now());
  } else if (!options.showOverdueOnly && overdueReferenceTimeRef.current !== null) {
    overdueReferenceTimeRef.current = null;
  }

  const trimmedSearchTerm = options.searchTerm?.trim() ?? '';
  const vespaTokens = useMemo(
    () => [...(options.dynamicFieldVespaTokens ?? [])].sort(),
    [options.dynamicFieldVespaTokens],
  );
  const vespaDateRangeCount = Object.keys(options.dynamicFieldDateRanges ?? {}).length;
  const requiresVespaIds =
    trimmedSearchTerm.length > 0 || vespaTokens.length > 0 || vespaDateRangeCount > 0;

  const parsedAssignee = options.filters?.assignee?.length
    ? parseAssigneeFilter(options.filters.assignee)
    : null;
  const vespaAssignee =
    parsedAssignee && parsedAssignee.ids.length > 0 && !parsedAssignee.inverted
      ? parsedAssignee.ids.map(id => id.replace(/^(user:|group:|userGroup:)/, '')).join(',')
      : undefined;
  const vespaPriority = options.filters?.priority?.length
    ? options.filters.priority.join(',')
    : undefined;
  const vespaTags = options.filters?.tags?.length ? options.filters.tags.join(',') : undefined;
  const effectiveVespaBoardId =
    options.boardId ??
    (options.filters?.boards?.length === 1 ? options.filters.boards[0] : undefined);

  const groupByKey =
    typeof options.groupBy === 'object'
      ? `${options.groupBy.type}:${options.groupBy.fieldId}`
      : String(options.groupBy ?? 'none');
  const vespaSearchKey = `table:${groupByKey}:${options.groupKey ?? ''}`;

  const vespaTicketSearch = useVespaTicketSearch({
    searchTerm: trimmedSearchTerm,
    dynamicFieldValues: vespaTokens,
    enabled: requiresVespaIds && enabled,
    limit: trimmedSearchTerm ? 400 : 200,
    fetchAllDynamicFieldMatches: true,
    maxFetchedResults: trimmedSearchTerm ? 800 : 400,
    searchKey: vespaSearchKey,
    ...(options.dynamicFieldDateRanges
      ? { dynamicFieldDateRanges: options.dynamicFieldDateRanges }
      : {}),
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(effectiveVespaBoardId ? { boardId: effectiveVespaBoardId } : {}),
    ...(vespaPriority ? { priority: vespaPriority } : {}),
    ...(vespaAssignee ? { assignee: vespaAssignee } : {}),
    ...(vespaTags ? { tags: vespaTags } : {}),
  });
  const vespaTicketIds = requiresVespaIds
    ? (vespaTicketSearch.searchResults?.map(ticket => ticket.id) ?? null)
    : undefined;
  const vespaIdsKey = requiresVespaIds ? (vespaTicketIds?.join(',') ?? 'pending') : 'off';

  const basePageArgs = useMemo(
    () =>
      withTicketChannelScope(
        {
          viewMode: options.viewMode,
          projectId: options.projectId,
          boardId: options.boardId,
          excludeFlowSteps: options.excludeFlowSteps,
          limit: pageSize,
          start: null as PageCursor | null,
          groupBy: options.groupBy,
          groupKey: options.groupKey,
          formFieldValue: getFormFieldValue(options.groupBy, options.groupKey),
          ...(vespaTicketIds ? { vespaTicketIds } : {}),
          dynamicFieldScalarFilters: getDynamicFieldScalarFilters(
            options.filters,
            options.zeroOnlyDynamicFieldIds,
          ),
          filters: toQueryFilters(options.filters),
          formEntityValueFieldIds: options.formEntityValueFieldIds,
          showOverdueOnly: options.showOverdueOnly,
          overdueReferenceTime: overdueReferenceTimeRef.current ?? undefined,
        },
        options.channelId,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fields enumerated; vespa ids keyed by content
    [
      options.viewMode,
      options.projectId,
      options.boardId,
      options.excludeFlowSteps,
      options.groupBy,
      options.groupKey,
      options.filters,
      options.zeroOnlyDynamicFieldIds,
      options.formEntityValueFieldIds,
      options.showOverdueOnly,
      options.channelId,
      pageSize,
      vespaIdsKey,
    ],
  );

  const queryKey = useMemo(() => {
    const { start: _start, ...rest } = basePageArgs as Record<string, unknown>;
    return JSON.stringify(rest);
  }, [basePageArgs]);

  const lastQueryKeyRef = useRef(queryKey);
  if (lastQueryKeyRef.current !== queryKey) {
    lastQueryKeyRef.current = queryKey;
    isLoadingMoreRef.current = false;
    setHasMore(true);
  }

  const cursor = cursorState?.queryKey === queryKey ? cursorState.cursor : null;
  const tickets = ticketsState.queryKey === queryKey ? ticketsState.tickets : [];

  const pageEnabled = enabled && (!requiresVespaIds || vespaTicketIds !== null);

  const pageArgs = useMemo(() => ({ ...basePageArgs, start: cursor }), [basePageArgs, cursor]);
  const [page, pageDetails] = useCachedQuery(
    queries.tableTicketsPage(pageArgs as Parameters<typeof queries.tableTicketsPage>[0]),
    { enabled: pageEnabled },
  );

  const pageDetailsType = pageDetails.type;
  useEffect(() => {
    if (pageDetailsType === 'error') isLoadingMoreRef.current = false;
  }, [pageDetailsType]);

  const hasMoreSigRef = useRef('');
  useEffect(() => {
    if (pageDetailsType !== 'complete' || !pageEnabled) return;
    isLoadingMoreRef.current = false;
    const pageRows = (page ?? []) as KanbanTicketsPageRow[];
    const prev = ticketsStateRef.current;
    const previousTickets = prev.queryKey === queryKey && cursor ? prev.tickets : [];
    const combined = [...previousTickets, ...pageRows];
    const unique = Array.from(new Map(combined.map(t => [t.id, t])).values());
    setTicketsState(current =>
      current.queryKey === queryKey &&
      current.tickets.length === unique.length &&
      current.tickets.every((t, i) => t === unique[i])
        ? current
        : { queryKey, tickets: unique },
    );
    const signature = `${queryKey}|${cursor ? `${cursor.createdAt}:${cursor.id}` : 'first'}`;
    if (hasMoreSigRef.current !== signature) {
      hasMoreSigRef.current = signature;
      setHasMore(pageRows.length >= pageSize);
    }
  }, [pageDetailsType, page, pageEnabled, queryKey, cursor, pageSize]);

  const [headPage, headPageDetails] = useCachedQuery(
    queries.tableTicketsPage(basePageArgs as Parameters<typeof queries.tableTicketsPage>[0]),
    { enabled: pageEnabled && cursor !== null },
  );
  useEffect(() => {
    if (cursor === null || headPageDetails.type !== 'complete' || !pageEnabled) return;
    const headRows = (headPage ?? []) as KanbanTicketsPageRow[];
    if (headRows.length === 0) return;
    setTicketsState(current => {
      if (current.queryKey !== queryKey) return current;
      const headIds = new Set(headRows.map(row => row.id));
      const merged = [...headRows, ...current.tickets.filter(t => !headIds.has(t.id))];
      return merged.length === current.tickets.length &&
        merged.every((t, i) => t === current.tickets[i])
        ? current
        : { queryKey, tickets: merged };
    });
  }, [headPage, headPageDetails.type, cursor, pageEnabled, queryKey]);

  const lastRow = tickets.length > 0 ? tickets[tickets.length - 1] : null;
  const loadMore = useCallback(() => {
    if (isLoadingMoreRef.current || !hasMore || !lastRow) return;
    isLoadingMoreRef.current = true;
    setCursorState({ queryKey, cursor: { createdAt: lastRow.createdAt, id: lastRow.id } });
  }, [hasMore, lastRow, queryKey]);

  const loadedIds = useMemo(() => tickets.map(t => t.id), [tickets]);
  const chunkIds: string[][] = [];
  for (let i = 0; i < OVERLAY_CHUNKS; i += 1) {
    chunkIds.push(
      loadedIds.length > i * OVERLAY_CHUNK_SIZE
        ? loadedIds.slice(i * OVERLAY_CHUNK_SIZE, (i + 1) * OVERLAY_CHUNK_SIZE)
        : EMPTY_IDS,
    );
  }
  /* eslint-disable react-hooks/rules-of-hooks -- OVERLAY_CHUNKS is a module constant; hook count is fixed every render */
  const chunkResults = chunkIds.map(ids =>
    useCachedQuery(queries.ticketsByIds({ ticketIds: ids }), { enabled: ids.length > 0 }),
  );
  /* eslint-enable react-hooks/rules-of-hooks */
  const chunkRows = chunkResults.map(result => result[0]);
  const chunkStates = chunkResults.map(result => result[1].type).join(',');

  const overlaid = useMemo(() => {
    const liveById = new Map<string, KanbanTicketsPageRow>();
    const answeredIds = new Set<string>();
    chunkRows.forEach((rows, index) => {
      for (const row of rows ?? []) liveById.set(row.id, row as KanbanTicketsPageRow);
      if (chunkResults[index]?.[1].type === 'complete') {
        for (const id of chunkIds[index] ?? []) answeredIds.add(id);
      }
    });
    if (liveById.size === 0 && answeredIds.size === 0) return tickets;

    let changed = false;
    const next: KanbanTicketsPageRow[] = [];
    for (const row of tickets) {
      const live = liveById.get(row.id);
      if (live) {
        const stale =
          live.updatedAt !== row.updatedAt ||
          (live as { tagMappings?: unknown }).tagMappings !==
            (row as { tagMappings?: unknown }).tagMappings;
        const merged = stale ? ({ ...row, ...live } as KanbanTicketsPageRow) : row;
        if (merged !== row) changed = true;
        if ((merged as Ticket & { isArchived?: boolean }).isArchived) {
          changed = true;
          continue;
        }
        if (!rowMatchesGroup(merged as Ticket, options.groupBy, options.groupKey)) {
          changed = true;
          continue;
        }
        next.push(merged);
      } else if (answeredIds.has(row.id)) {
        changed = true;
        continue;
      } else {
        next.push(row);
      }
    }
    return changed ? next : tickets;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chunk identities tracked via chunkRows/chunkStates
  }, [tickets, options.groupBy, options.groupKey, chunkStates, ...chunkRows]);

  const isSearchMode = requiresVespaIds;
  const isFirstPageLoading =
    enabled &&
    tickets.length === 0 &&
    hasMore &&
    pageDetailsType !== 'complete' &&
    pageDetailsType !== 'error';

  return {
    tickets: overlaid,
    isLoading: isFirstPageLoading,
    isLoadingMore: isLoadingMoreRef.current,
    hasMore:
      hasMore &&
      !(isSearchMode && Array.isArray(vespaTicketIds) && tickets.length >= vespaTicketIds.length),
    loadMore,
    isSearchMode,
  };
};
