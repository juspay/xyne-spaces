import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FormEntityValues,
  Ticket,
  TicketAssignment,
  TicketStageEta,
  TicketTagMapping,
  FlowStepVisibilityOptions,
} from '@xyne/shared';
import { queries, parseAssigneeFilter } from '../../zero/queries';
import type { TicketFilters } from '../../components/Tickets/TicketFilters/types';
import { FormFieldType } from '@xyne/shared';
import { useVespaTicketSearch } from '../../hooks/useVespaTicketSearch';
import { useCachedQuery } from '@xyne/shared/hooks';
import { sortByKanbanPosition } from './KanbanBoardScreen.utils';
import { withTicketChannelScope } from './ticketChannelScope';

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

export type KanbanTicketsPageBaseArgs = FlowStepVisibilityOptions & {
  viewMode: KanbanViewMode;
  channelId?: string;
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
  dynamicFieldDateRanges?: Record<string, { start?: number; end?: number }>;
  zeroOnlyDynamicFieldIds?: string[];
  vespaTicketIds?: string[];
  showOverdueOnly?: boolean;
  overdueReferenceTime?: number | null;
};

type KanbanCursor = {
  createdAt: number;
  id: string;
};

type KanbanTicketsPageQueryArgs = Omit<
  Parameters<typeof queries.kanbanTicketsPageV3>[0],
  'start'
> & {
  start: KanbanCursor | null;
  dynamicFieldDateRanges?: Record<string, { start?: number; end?: number }>;
};

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
  /** True when tickets come directly from Vespa search (trusted, already filtered) */
  isUsingDirectVespaRows: boolean;
};

const DEFAULT_PAGE_SIZE = 20;
const MINUTE_MS = 60 * 1000;
const VESPA_MISSING_DYNAMIC_FIELD_VALUE = '__VESPA_MISSING__';

const ceilToMinute = (timestamp: number): number => Math.ceil(timestamp / MINUTE_MS) * MINUTE_MS;
const MISSING_FORM_FIELD_GROUP_KEYS = new Set(['No Value', 'Unassigned']);

const isMaterializedFlowStep = (ticket: KanbanTicketsPageRow): boolean => {
  const metadata = ticket.metadata as
    | { flow?: { planNodeId?: unknown } | undefined }
    | null
    | undefined;
  return typeof metadata?.flow?.planNodeId === 'string';
};

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
  zeroOnlyDynamicFieldIds: string[] | undefined,
  dynamicFieldDateRanges: Record<string, { start?: number; end?: number }> | undefined,
): boolean => {
  if (!filters) return false;

  const {
    dynamicFields,
    roleAssignments,
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
    roleAssignments?.some(ra => ra.userIds.length > 0) ||
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

  const zeroOnlyFieldIds = new Set(zeroOnlyDynamicFieldIds ?? []);
  const vespaDateRangeFieldIds = new Set(Object.keys(dynamicFieldDateRanges ?? {}));
  return Object.entries(dynamicFields).some(([fieldId, value]) => {
    if (zeroOnlyFieldIds.has(fieldId)) return true;
    if (Array.isArray(value)) return false;
    return !vespaDateRangeFieldIds.has(fieldId);
  });
};

const canRepresentGroupInVespa = (
  groupBy: KanbanPageGroupBy | undefined,
  groupKey: string | undefined,
): boolean => {
  if (!groupBy || groupBy === 'none') return true;
  if (groupBy === 'assignee') {
    return Boolean(groupKey) && groupKey !== 'Unassigned';
  }
  if (groupBy === 'priority') {
    return Boolean(groupKey) && groupKey !== 'No Priority';
  }
  if (groupBy === 'status') {
    return Boolean(groupKey);
  }
  if (typeof groupBy !== 'object' || groupBy.type !== 'formField') return false;
  if (!groupKey) return false;
  // All form field groups can be represented (MISSING_FORM_FIELD_GROUP_KEYS handled via
  // __VESPA_MISSING__ token). DATE groupBy is not supported in the UI, so no special case.
  return true;
};

const getDynamicFieldScalarFilters = (
  filters: TicketFilters | undefined,
  zeroOnlyDynamicFieldIds: string[] | undefined,
): DynamicFieldScalarFilter[] | undefined => {
  const dynamicFields = filters?.dynamicFields;
  if (!dynamicFields) return undefined;

  const scalarFilters: DynamicFieldScalarFilter[] = [];
  const zeroOnlyFieldIds = new Set(zeroOnlyDynamicFieldIds ?? []);

  for (const [fieldId, value] of Object.entries(dynamicFields)) {
    if (zeroOnlyFieldIds.has(fieldId)) continue;
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
    boards: filters.boards,
    assignee: filters.assignee,
    userGroups: filters.userGroups,
    createdBy: filters.createdBy,
    roleAssignments: filters.roleAssignments,
    dueDateStart: filters.dueDateStart,
    dueDateEnd: filters.dueDateEnd,
    createdDateStart: filters.createdDateStart,
    createdDateEnd: filters.createdDateEnd,
    tags: filters.tags,
    assigned: filters.assigned,
    created: filters.created,
    stages: filters.stages,
    ticketTypes: filters.ticketTypes,
    sourceChannels: filters.sourceChannels,
  };
};

export const buildKanbanTicketsPageArgs = (
  options: UseKanbanTicketsPageOptions,
  start: KanbanTicketsPageQueryArgs['start'],
): KanbanTicketsPageQueryArgs =>
  withTicketChannelScope(
    {
      viewMode: options.viewMode,
      projectId: options.projectId,
      boardId: options.boardId,
      userId: options.userId,
      groupId: options.groupId,
      excludeFlowSteps: options.excludeFlowSteps,
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
        options.zeroOnlyDynamicFieldIds,
      ),
      filters: toQueryFilters(options.filters),
      formEntityValueFieldIds: options.formEntityValueFieldIds,
      ...(options.dynamicFieldDateRanges
        ? { dynamicFieldDateRanges: options.dynamicFieldDateRanges }
        : {}),
      showOverdueOnly: options.showOverdueOnly,
      overdueReferenceTime: options.overdueReferenceTime ?? undefined,
    },
    options.channelId,
  );

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

// Assignee-specific: understands the "unassigned" sentinel and invert marker.
const matchesAssigneeFilter = (
  value: string | null | undefined,
  filterValues: string[] | undefined,
): boolean => {
  if (!filterValues?.length) return true;
  const { inverted, includeUnassigned, ids } = parseAssigneeFilter(filterValues);
  if (!ids.length && !includeUnassigned) return true;
  const normalizedValue = normalizeIdentity(value);
  const matches = normalizedValue
    ? ids.some(id => normalizeIdentity(id) === normalizedValue)
    : includeUnassigned;
  return inverted ? !matches : matches;
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
  if (filters?.sourceChannels?.length && !filters.sourceChannels.includes(ticket.channelId)) {
    reasons.push('sourceChannels');
  }
  if (!matchesAssigneeFilter(ticket.assignedTo, filters?.assignee)) {
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
  const pageVespaDateRangeCount = Object.keys(options.dynamicFieldDateRanges ?? {}).length;
  if (typeof options.groupBy === 'object' && options.groupBy?.type === 'formField') {
    // Add a token for form field groupBy to ensure Vespa search filters by this field.
    // DATE groupBy is not supported in the UI, so no special handling needed.
    const fieldId = options.groupBy.fieldId;
    const groupKey = options.groupKey ?? '';

    if (MISSING_FORM_FIELD_GROUP_KEYS.has(groupKey) || !groupKey) {
      pageVespaTokensSet.add(`${fieldId}::${VESPA_MISSING_DYNAMIC_FIELD_VALUE}`);
    } else {
      pageVespaTokensSet.add(`${fieldId}::${groupKey}`);
    }
  }
  const pageVespaTokens = Array.from(pageVespaTokensSet).sort();
  const hasSearchTerm = trimmedSearchTerm.length > 0;
  const requiresVespaTicketIds =
    pageVespaTokens.length > 0 || pageVespaDateRangeCount > 0 || hasSearchTerm;
  const effectiveVespaBoardId =
    options.boardId ??
    (options.filters?.boards?.length === 1 ? options.filters.boards[0] : undefined);
  const shouldUseDirectVespaRows =
    requiresVespaTicketIds &&
    !hasZeroOnlyFilters(
      options.filters,
      options.zeroOnlyDynamicFieldIds,
      options.dynamicFieldDateRanges,
    ) &&
    canRepresentGroupInVespa(options.groupBy, options.groupKey) &&
    !options.showOverdueOnly;

  // Convert filter arrays to comma-separated strings for Vespa (only if non-empty)
  const vespaPriority =
    options.filters?.priority && options.filters.priority.length > 0
      ? options.filters.priority.join(',')
      : undefined;

  // Parse assignee filter to extract real user IDs, excluding sentinels.
  // Vespa can't handle 'unassigned' or inverted selections, so skip those cases.
  const parsedAssignee = options.filters?.assignee?.length
    ? parseAssigneeFilter(options.filters.assignee)
    : null;
  // Only send to Vespa when we have real IDs and not inverted/includeUnassigned
  // (those semantics require the Zero/local filter path).
  // Send all 4 identity forms to match prefixedKanbanIdentityValues storage variants.
  const vespaAssignee =
    parsedAssignee &&
    parsedAssignee.ids.length > 0 &&
    !parsedAssignee.inverted &&
    !parsedAssignee.includeUnassigned
      ? parsedAssignee.ids
          .flatMap(id => {
            const bareId = id.replace(/^(user:|group:|userGroup:)/, '');
            return [bareId, `user:${bareId}`, `group:${bareId}`, `userGroup:${bareId}`];
          })
          .join(',')
      : undefined;

  const vespaTags =
    options.filters?.tags && options.filters.tags.length > 0
      ? options.filters.tags.join(',')
      : undefined;

  // Send all 4 identity forms to match prefixedKanbanIdentityValues storage variants.
  const vespaCreatedBy =
    options.filters?.createdBy && options.filters.createdBy.length > 0
      ? options.filters.createdBy
          .flatMap(id => {
            const bareId = id.replace(/^(user:|group:|userGroup:)/, '');
            return [bareId, `user:${bareId}`, `group:${bareId}`, `userGroup:${bareId}`];
          })
          .join(',')
      : undefined;

  // Compute group-specific filter for Vespa based on groupBy/groupKey
  // This ensures search results are filtered to only show in the correct group
  const vespaGroupFilter: { priority?: string; assignee?: string; status?: string } = (() => {
    if (!options.groupBy || options.groupBy === 'none' || !options.groupKey) {
      return {};
    }
    if (options.groupBy === 'priority') {
      // Don't filter if groupKey is the "No Priority" placeholder
      if (options.groupKey === 'No Priority') return {};
      return { priority: options.groupKey };
    }
    if (options.groupBy === 'assignee') {
      // Don't filter if groupKey is "Unassigned" - Vespa can't filter for null assignee easily
      if (options.groupKey === 'Unassigned') return {};
      // Vespa may store assignedTo in any of these forms (see prefixedKanbanIdentityValues).
      // Send all variants so we match regardless of storage format.
      const bareId = options.groupKey.replace(/^(user:|group:|userGroup:)/, '');
      return {
        assignee: [bareId, `user:${bareId}`, `group:${bareId}`, `userGroup:${bareId}`].join(','),
      };
    }
    if (options.groupBy === 'status') {
      // Filter by the group's status value
      return { status: options.groupKey };
    }
    // For formField grouping, dynamic field tokens already handle it
    return {};
  })();

  // Create a search key that changes when the group context changes
  // This forces the search to re-trigger when switching views
  const groupByKey =
    typeof options.groupBy === 'object'
      ? `${options.groupBy.type}:${options.groupBy.fieldId}`
      : String(options.groupBy ?? 'none');
  const vespaSearchKey = `${groupByKey}:${options.groupKey ?? ''}:${options.stageName}`;

  const vespaTicketSearch = useVespaTicketSearch({
    searchTerm: trimmedSearchTerm,
    dynamicFieldValues: pageVespaTokens,
    enabled: requiresVespaTicketIds,
    limit: 200,
    fetchAllDynamicFieldMatches: true,
    maxFetchedResults: 400,
    searchKey: vespaSearchKey,
    ...(options.dynamicFieldDateRanges
      ? { dynamicFieldDateRanges: options.dynamicFieldDateRanges }
      : {}),
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(effectiveVespaBoardId ? { boardId: effectiveVespaBoardId } : {}),
    ...(options.columnType === 'status' ? { status: options.stageName } : {}),
    ...(options.columnType === 'stage' ? { stage: options.stageName } : {}),
    ...(vespaPriority ? { priority: vespaPriority } : {}),
    ...(vespaAssignee ? { assignee: vespaAssignee } : {}),
    ...(vespaTags ? { tags: vespaTags } : {}),
    ...(vespaCreatedBy ? { createdBy: vespaCreatedBy } : {}),
    ...vespaGroupFilter,
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
    sourceChannels: options.filters?.sourceChannels ?? [],
  });
  const directVespaPage = useMemo(
    () =>
      shouldUseDirectVespaRows
        ? applyLocalVespaFilters(
            options.channelId
              ? (vespaTicketSearch.searchResults?.filter(
                  ticket => ticket.channelId === options.channelId,
                ) ?? null)
              : vespaTicketSearch.searchResults,
            options.filters,
          )
        : null,
    [localFilterKey, options.channelId, shouldUseDirectVespaRows, vespaTicketSearch.searchResults],
  );
  const vespaTicketIds = requiresVespaTicketIds
    ? (vespaTicketSearch.searchResults?.map(ticket => ticket.id) ?? [])
    : undefined;

  if (options.showOverdueOnly && overdueReferenceTimeRef.current === null) {
    overdueReferenceTimeRef.current = ceilToMinute(Date.now());
  } else if (!options.showOverdueOnly && overdueReferenceTimeRef.current !== null) {
    overdueReferenceTimeRef.current = null;
  }

  const overdueReferenceTime = overdueReferenceTimeRef.current;
  const pageOptions = {
    ...options,
    ...(!shouldUseDirectVespaRows && vespaTicketIds !== undefined ? { vespaTicketIds } : {}),
    overdueReferenceTime,
  };
  const basePageArgs = buildKanbanTicketsPageArgs(pageOptions, null);
  const { start: _start, ...queryKeyArgs } = basePageArgs;
  const queryKey = JSON.stringify(queryKeyArgs);
  const fetchCursor = fetchCursorState?.queryKey === queryKey ? fetchCursorState.cursor : null;
  const tickets = ticketsState.queryKey === queryKey ? ticketsState.tickets : [];
  const pageArgs = buildKanbanTicketsPageArgs(pageOptions, fetchCursor);
  const pageQuery = queries.kanbanTicketsPageV3(
    pageArgs as Parameters<typeof queries.kanbanTicketsPageV3>[0],
  );
  const [page, pageDetails] = useCachedQuery(pageQuery, {
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

  const preserveRelevanceOrder = shouldUseDirectVespaRows && hasSearchTerm;

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

    const rawPageRows = (effectivePage ?? []) as KanbanTicketsPageRow[];
    const visiblePageRows = options.excludeFlowSteps
      ? rawPageRows.filter(ticket => !isMaterializedFlowStep(ticket))
      : rawPageRows;
    const pageRows = preserveRelevanceOrder
      ? visiblePageRows
      : sortByKanbanPosition(visiblePageRows);
    if (typeof window !== 'undefined') {
      const debugDynamicFieldIds = new Set<string>();
      if (options.filters?.dynamicFields) {
        Object.keys(options.filters.dynamicFields).forEach(fieldId =>
          debugDynamicFieldIds.add(fieldId),
        );
      }
      if (typeof options.groupBy === 'object' && options.groupBy?.type === 'formField') {
        debugDynamicFieldIds.add(options.groupBy.fieldId);
      }
    }
    if (rawPageRows.length === 0) {
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
      if (shouldUseDirectVespaRows || fetchCursor === null) {
        return { queryKey, tickets: pageRows };
      }

      const previousTickets = prev.queryKey === queryKey ? prev.tickets : [];
      const combined = [...previousTickets, ...pageRows];
      const unique = Array.from(new Map(combined.map(ticket => [ticket.id, ticket])).values());
      return { queryKey, tickets: unique };
    });

    if (shouldUseDirectVespaRows) {
      setNextCursor(null);
      setHasMore(false);
      return;
    }

    setHasMore(rawPageRows.length >= (options.pageSize ?? DEFAULT_PAGE_SIZE));

    const lastItemOfPage = rawPageRows.at(-1);
    if (lastItemOfPage) {
      setNextCursor({
        createdAt: lastItemOfPage.createdAt,
        id: lastItemOfPage.id,
      });
    } else {
      setNextCursor(null);
    }
  }, [
    fetchCursor,
    queryKey,
    options.pageSize,
    options.excludeFlowSteps,
    effectivePage,
    effectivePageDetailsType,
    shouldUseDirectVespaRows,
    preserveRelevanceOrder,
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
    isUsingDirectVespaRows: shouldUseDirectVespaRows,
  };
};
