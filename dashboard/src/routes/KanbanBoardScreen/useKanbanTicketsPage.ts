import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FormEntityValues,
  Ticket,
  TicketAssignment,
  TicketStageEta,
  TicketTagMapping,
} from '@xyne/shared';
import { queries } from '../../zero/queries';
import type { TicketFilters } from '../../components/Tickets/TicketFilters/types';
import { FormFieldType } from '@xyne/shared';
import { useVespaTicketSearch } from '../../hooks/useVespaTicketSearch';
import { useCachedQuery } from '@xyne/shared/hooks';

export type KanbanTicketsPageRow = Ticket & {
  assignments?: TicketAssignment[];
  stageEtaEntries?: TicketStageEta[];
  tagMappings?: TicketTagMapping[];
  formEntityValues?: Array<FormEntityValues & { formField?: unknown }>;
};

export type KanbanViewMode = 'project' | 'board' | 'my-tickets' | 'user-tickets' | 'group-tickets';

export type KanbanPageGroupBy =
  | 'none'
  | 'assignee'
  | 'status'
  | 'priority'
  | {
      type: 'formField';
      fieldId: string;
      fieldName?: string;
      fieldType?: string;
    };

export type KanbanTicketsPageBaseArgs = {
  viewMode: KanbanViewMode;
  projectId?: string;
  boardId?: string;
  userId?: string;
  groupId?: string;
  searchTerm?: string;
  groupBy?: KanbanPageGroupBy;
  groupKey?: string;
  filters?: TicketFilters;
  formEntityValueFieldIds?: string[];
  dynamicFieldVespaTokens?: string[];
  arrayBackedDynamicFieldIds?: string[];
  vespaTicketIds?: string[];
  showOverdueOnly?: boolean;
  overdueReferenceTime?: number | null;
};

type KanbanTicketsPageQueryArgs = Parameters<typeof queries.kanbanTicketsPage>[0];
type KanbanCursor = NonNullable<KanbanTicketsPageQueryArgs['start']>;

type DynamicFieldScalarFilter = NonNullable<
  KanbanTicketsPageQueryArgs['dynamicFieldScalarFilters']
>[number];

type UseKanbanTicketsPageOptions = KanbanTicketsPageBaseArgs & {
  columnType?: 'stage' | 'status';
  stageName: string;
  enabled?: boolean;
  pageSize?: number;
};

type UseKanbanTicketsPageResult = {
  tickets: KanbanTicketsPageRow[];
  detailsType: 'unknown' | 'error' | 'complete';
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  reset: () => void;
};

const DEFAULT_PAGE_SIZE = 20;
const VESPA_MISSING_DYNAMIC_FIELD_VALUE = '__VESPA_MISSING__';
const MISSING_FORM_FIELD_GROUP_KEYS = new Set(['No Value', 'Unassigned']);

type TicketsState = {
  queryKey: string;
  tickets: KanbanTicketsPageRow[];
};

type FetchCursorState = {
  queryKey: string;
  cursor: KanbanCursor;
};

const hasZeroOnlyFilters = (
  filters: TicketFilters | undefined,
  arrayBackedDynamicFieldIds: string[] | undefined,
): boolean => {
  if (!filters) return false;

  const {
    dynamicFields,
    prReviewers,
    qaAssigned,
    dueDateStart,
    dueDateEnd,
    createdDateStart,
    createdDateEnd,
    assigned,
    created,
    aiCategory,
    hasAiDraft,
  } = filters;

  if (
    prReviewers?.length ||
    qaAssigned?.length ||
    dueDateStart !== undefined ||
    dueDateEnd !== undefined ||
    createdDateStart !== undefined ||
    createdDateEnd !== undefined ||
    assigned !== undefined ||
    created !== undefined ||
    aiCategory?.length ||
    hasAiDraft !== undefined
  ) {
    return true;
  }

  if (!dynamicFields) return false;

  const arrayBackedFieldIds = new Set(arrayBackedDynamicFieldIds ?? []);
  return Object.entries(dynamicFields).some(([fieldId, value]) => {
    if (!arrayBackedFieldIds.has(fieldId)) return true;
    return !Array.isArray(value);
  });
};

const canRepresentGroupInVespa = (
  groupBy: KanbanPageGroupBy | undefined,
  groupKey: string | undefined,
): boolean => {
  if (!groupBy || groupBy === 'none') return true;
  if (groupBy === 'assignee' || groupBy === 'status' || groupBy === 'priority') {
    return true;
  }
  if (typeof groupBy !== 'object' || groupBy.type !== 'formField') return false;
  if (!groupKey) return false;
  if (MISSING_FORM_FIELD_GROUP_KEYS.has(groupKey)) return true;
  return (
    groupBy.fieldType === FormFieldType.MULTI_SELECT || groupBy.fieldType === FormFieldType.USER
  );
};

const getDynamicFieldScalarFilters = (
  filters: TicketFilters | undefined,
  arrayBackedDynamicFieldIds: string[] | undefined,
): DynamicFieldScalarFilter[] | undefined => {
  const dynamicFields = filters?.dynamicFields;
  if (!dynamicFields) return undefined;

  const scalarFilters: DynamicFieldScalarFilter[] = [];
  const arrayBackedFieldIds = new Set(arrayBackedDynamicFieldIds ?? []);

  for (const [fieldId, value] of Object.entries(dynamicFields)) {
    if (arrayBackedFieldIds.has(fieldId)) continue;
    if (!Array.isArray(value) || value.length === 0) continue;

    // Zero can express scalar equality for JSON values. Date ranges and array containment
    // still use the existing all-ticket path until those values are normalized/indexed.
    scalarFilters.push({ fieldId, values: value });
  }

  return scalarFilters.length > 0 ? scalarFilters : undefined;
};

const getFormFieldValue = (
  groupBy: KanbanPageGroupBy | undefined,
  groupKey: string | undefined,
): string | number | boolean | undefined => {
  if (!groupKey) return undefined;
  if (typeof groupBy !== 'object' || groupBy === null || groupBy.type !== 'formField')
    return undefined;
  if (MISSING_FORM_FIELD_GROUP_KEYS.has(groupKey)) return undefined;
  if (
    groupBy.fieldType === FormFieldType.MULTI_SELECT ||
    groupBy.fieldType === FormFieldType.USER
  ) {
    return undefined;
  }
  return groupKey;
};

const toQueryFilters = (
  filters: TicketFilters | undefined,
): KanbanTicketsPageQueryArgs['filters'] => {
  if (!filters) return undefined;

  return {
    priority: filters.priority,
    assignee: filters.assignee,
    userGroups: filters.userGroups,
    createdBy: filters.createdBy,
    prReviewers: filters.prReviewers,
    qaAssigned: filters.qaAssigned,
    dueDateStart: filters.dueDateStart,
    dueDateEnd: filters.dueDateEnd,
    createdDateStart: filters.createdDateStart,
    createdDateEnd: filters.createdDateEnd,
    tags: filters.tags,
    assigned: filters.assigned,
    created: filters.created,
    stages: filters.stages,
    ticketTypes: filters.ticketTypes,
  };
};

export const buildKanbanTicketsPageArgs = (
  options: UseKanbanTicketsPageOptions,
  start: KanbanTicketsPageQueryArgs['start'],
): KanbanTicketsPageQueryArgs => ({
  viewMode: options.viewMode,
  projectId: options.projectId,
  boardId: options.boardId,
  userId: options.userId,
  groupId: options.groupId,
  columnType: options.columnType,
  stageName: options.stageName,
  limit: options.pageSize ?? DEFAULT_PAGE_SIZE,
  start,
  groupBy: options.groupBy,
  groupKey: options.groupKey,
  formFieldValue: getFormFieldValue(options.groupBy, options.groupKey),
  vespaTicketIds: options.vespaTicketIds,
  dynamicFieldScalarFilters: getDynamicFieldScalarFilters(
    options.filters,
    options.arrayBackedDynamicFieldIds,
  ),
  filters: toQueryFilters(options.filters),
  formEntityValueFieldIds: options.formEntityValueFieldIds,
  showOverdueOnly: options.showOverdueOnly,
  overdueReferenceTime: options.overdueReferenceTime ?? undefined,
});

const sortByCursorOrder = (rows: KanbanTicketsPageRow[]): KanbanTicketsPageRow[] =>
  [...rows].sort((a, b) => {
    const aPos = a.kanbanPosition;
    const bPos = b.kanbanPosition;

    if (aPos !== null && aPos !== undefined && bPos !== null && bPos !== undefined) {
      if (aPos < bPos) return -1;
      if (aPos > bPos) return 1;
    }

    if ((aPos === null || aPos === undefined) && bPos !== null && bPos !== undefined) return 1;
    if (aPos !== null && aPos !== undefined && (bPos === null || bPos === undefined)) return -1;

    return a.id.localeCompare(b.id);
  });

const normalizeIdentity = (value: string | null | undefined): string =>
  (value ?? '').replace(/^user:/, '');

const matchesIdentityFilter = (
  value: string | null | undefined,
  filterValues: string[] | undefined,
): boolean => {
  if (!filterValues?.length) return true;
  const normalizedValue = normalizeIdentity(value);
  if (!normalizedValue) return false;
  return filterValues.some(filterValue => normalizeIdentity(filterValue) === normalizedValue);
};

const getTicketTagNames = (ticket: KanbanTicketsPageRow): Set<string> => {
  return new Set(
    (ticket.tagMappings ?? []).map(m => m.tagName).filter((name): name is string => Boolean(name)),
  );
};

const getLocalVespaFilterRejectReasons = (
  ticket: KanbanTicketsPageRow,
  filters: TicketFilters | undefined,
): string[] => {
  const reasons: string[] = [];

  if (filters?.priority?.length && !filters.priority.includes(ticket.priority)) {
    reasons.push('priority');
  }
  if (filters?.boards?.length && !filters.boards.includes(ticket.boardId)) {
    reasons.push('boards');
  }
  if (!matchesIdentityFilter(ticket.assignedTo, filters?.assignee)) {
    reasons.push('assignee');
  }
  if (!matchesIdentityFilter(ticket.createdBy, filters?.createdBy)) {
    reasons.push('createdBy');
  }
  if (filters?.userGroups?.length && !filters.userGroups.includes(ticket.userGroupId)) {
    reasons.push('userGroups');
  }
  if (filters?.tags?.length) {
    const ticketTagNames = getTicketTagNames(ticket);
    if (!filters.tags.some(tag => ticketTagNames.has(tag))) {
      reasons.push('tags');
    }
  }
  if (filters?.stages?.length && !filters.stages.includes(ticket.stageName)) {
    reasons.push('stages');
  }
  if (filters?.ticketTypes?.length && !filters.ticketTypes.includes(ticket.ticketType ?? '')) {
    reasons.push('ticketTypes');
  }

  return reasons;
};

const applyLocalVespaFilters = (
  rows: Ticket[] | null,
  filters: TicketFilters | undefined,
): KanbanTicketsPageRow[] | null => {
  if (rows === null) return null;

  const keptRows: KanbanTicketsPageRow[] = [];

  (rows as KanbanTicketsPageRow[]).forEach(ticket => {
    const rejectReasons = getLocalVespaFilterRejectReasons(ticket, filters);
    if (rejectReasons.length > 0) {
      return;
    }

    keptRows.push(ticket);
  });

  return keptRows;
};

export const useKanbanTicketsPage = (
  options: UseKanbanTicketsPageOptions,
): UseKanbanTicketsPageResult => {
  const [ticketsState, setTicketsState] = useState<TicketsState>({ queryKey: '', tickets: [] });
  const [fetchCursorState, setFetchCursorState] = useState<FetchCursorState | null>(null);
  const [nextCursor, setNextCursor] = useState<KanbanCursor | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const isLoadingMoreRef = useRef(false);
  const overdueReferenceTimeRef = useRef<number | null>(null);
  const trimmedSearchTerm = options.searchTerm?.trim() ?? '';
  const pageVespaTokensSet = new Set(options.dynamicFieldVespaTokens ?? []);
  if (
    typeof options.groupBy === 'object' &&
    options.groupBy?.type === 'formField' &&
    (options.groupBy.fieldType === FormFieldType.MULTI_SELECT ||
      options.groupBy.fieldType === FormFieldType.USER ||
      MISSING_FORM_FIELD_GROUP_KEYS.has(options.groupKey ?? ''))
  ) {
    if (MISSING_FORM_FIELD_GROUP_KEYS.has(options.groupKey ?? '')) {
      pageVespaTokensSet.add(`${options.groupBy.fieldId}::${VESPA_MISSING_DYNAMIC_FIELD_VALUE}`);
    } else if (options.groupKey) {
      pageVespaTokensSet.add(`${options.groupBy.fieldId}::${options.groupKey}`);
    }
  }
  const pageVespaTokens = Array.from(pageVespaTokensSet).sort();
  const hasSearchTerm = trimmedSearchTerm.length > 0;
  const requiresVespaTicketIds = pageVespaTokens.length > 0 || hasSearchTerm;
  const effectiveVespaBoardId =
    options.boardId ??
    (options.filters?.boards?.length === 1 ? options.filters.boards[0] : undefined);
  const shouldUseDirectVespaRows =
    requiresVespaTicketIds &&
    !hasZeroOnlyFilters(options.filters, options.arrayBackedDynamicFieldIds) &&
    canRepresentGroupInVespa(options.groupBy, options.groupKey) &&
    !options.showOverdueOnly;

  const vespaTicketSearch = useVespaTicketSearch({
    searchTerm: trimmedSearchTerm,
    dynamicFieldValues: pageVespaTokens,
    enabled: requiresVespaTicketIds,
    limit: 200,
    fetchAllDynamicFieldMatches: true,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(effectiveVespaBoardId ? { boardId: effectiveVespaBoardId } : {}),
    ...(options.columnType === 'status' ? { status: options.stageName } : {}),
    ...(options.columnType === 'stage' ? { stage: options.stageName } : {}),
  });
  const localFilterKey = JSON.stringify({
    priority: options.filters?.priority ?? [],
    boards: options.filters?.boards ?? [],
    assignee: options.filters?.assignee ?? [],
    userGroups: options.filters?.userGroups ?? [],
    createdBy: options.filters?.createdBy ?? [],
    tags: options.filters?.tags ?? [],
    stages: options.filters?.stages ?? [],
    ticketTypes: options.filters?.ticketTypes ?? [],
  });
  const directVespaPage = useMemo(
    () =>
      shouldUseDirectVespaRows
        ? applyLocalVespaFilters(vespaTicketSearch.searchResults, options.filters)
        : null,
    [localFilterKey, shouldUseDirectVespaRows, vespaTicketSearch.searchResults],
  );
  const vespaTicketIds = requiresVespaTicketIds
    ? (vespaTicketSearch.searchResults?.map(ticket => ticket.id) ?? [])
    : undefined;

  if (options.showOverdueOnly && overdueReferenceTimeRef.current === null) {
    overdueReferenceTimeRef.current = Date.now();
  } else if (!options.showOverdueOnly && overdueReferenceTimeRef.current !== null) {
    overdueReferenceTimeRef.current = null;
  }

  const overdueReferenceTime = overdueReferenceTimeRef.current;
  const pageOptions = {
    ...options,
    ...(vespaTicketIds !== undefined ? { vespaTicketIds } : {}),
    overdueReferenceTime,
  };
  const basePageArgs = buildKanbanTicketsPageArgs(pageOptions, null);
  const queryKey = JSON.stringify(basePageArgs);
  const fetchCursor = fetchCursorState?.queryKey === queryKey ? fetchCursorState.cursor : null;
  const tickets = ticketsState.queryKey === queryKey ? ticketsState.tickets : [];
  const pageArgs = buildKanbanTicketsPageArgs(pageOptions, fetchCursor);
  const [page, pageDetails] = useCachedQuery(queries.kanbanTicketsPage(pageArgs), {
    enabled:
      (options.enabled ?? true) &&
      !shouldUseDirectVespaRows &&
      (!requiresVespaTicketIds || vespaTicketSearch.searchResults !== null),
  });
  const effectivePage = shouldUseDirectVespaRows ? directVespaPage : page;
  const effectivePageDetailsType = shouldUseDirectVespaRows
    ? directVespaPage === null
      ? 'unknown'
      : 'complete'
    : pageDetails.type;

  useEffect(() => {
    setTicketsState(prev =>
      prev.queryKey === queryKey && prev.tickets.length === 0 ? prev : { queryKey, tickets: [] },
    );
    setFetchCursorState(null);
    setNextCursor(null);
    setHasMore(true);
    isLoadingMoreRef.current = false;
  }, [queryKey, shouldUseDirectVespaRows]);

  useEffect(() => {
    if (effectivePageDetailsType !== 'complete') return;
    isLoadingMoreRef.current = false;

    const pageRows = (effectivePage ?? []) as KanbanTicketsPageRow[];
    if (pageRows.length === 0) {
      if (fetchCursor === null) {
        setTicketsState(prev =>
          prev.queryKey === queryKey && prev.tickets.length === 0
            ? prev
            : { queryKey, tickets: [] },
        );
      }
      setNextCursor(null);
      setHasMore(false);
      return;
    }

    setTicketsState(prev => {
      if (fetchCursor === null || shouldUseDirectVespaRows) {
        return { queryKey, tickets: pageRows };
      }

      const previousTickets = prev.queryKey === queryKey ? prev.tickets : [];
      const combined = [...previousTickets, ...pageRows];
      const unique = Array.from(new Map(combined.map(ticket => [ticket.id, ticket])).values());
      return { queryKey, tickets: sortByCursorOrder(unique) };
    });

    if (shouldUseDirectVespaRows) {
      setNextCursor(null);
      setHasMore(false);
      return;
    }

    setHasMore(pageRows.length >= (options.pageSize ?? DEFAULT_PAGE_SIZE));

    const lastItemOfPage = pageRows.at(-1);
    if (lastItemOfPage?.kanbanPosition) {
      setNextCursor({
        kanbanPosition: lastItemOfPage.kanbanPosition,
        id: lastItemOfPage.id,
      });
    } else {
      setNextCursor(null);
      setHasMore(false);
    }
  }, [
    fetchCursor,
    queryKey,
    options.pageSize,
    effectivePage,
    effectivePageDetailsType,
    shouldUseDirectVespaRows,
  ]);

  const loadMore = useCallback(() => {
    if (isLoadingMoreRef.current || !hasMore || !nextCursor) return;
    isLoadingMoreRef.current = true;
    setFetchCursorState({ queryKey, cursor: nextCursor });
  }, [hasMore, nextCursor, queryKey]);

  const reset = useCallback(() => {
    setTicketsState({ queryKey, tickets: [] });
    setFetchCursorState(null);
    setNextCursor(null);
    setHasMore(true);
    isLoadingMoreRef.current = false;
  }, [queryKey]);

  const isLoadingMore =
    !shouldUseDirectVespaRows && fetchCursor !== null && pageDetails.type !== 'complete';

  return {
    tickets,
    detailsType: effectivePageDetailsType,
    hasMore,
    isLoadingMore,
    loadMore,
    reset,
  };
};
