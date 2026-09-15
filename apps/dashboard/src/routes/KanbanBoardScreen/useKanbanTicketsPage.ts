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
  createdAfter?: number | null;
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

const DAY_MS = 86_400_000;
/**
 * Sliding-window steps for the page query's far-side `createdAt` bound, widened in
 * order until a page comes back full. The last step is "no bound at all", so nothing
 * is ever permanently hidden — a dormant board just costs a few probes to reach, and
 * a window containing no rows scans zero rows (the index seek finds nothing).
 */
const WINDOW_STEPS_MS: readonly number[] = [30 * DAY_MS, 60 * DAY_MS, 180 * DAY_MS, 365 * DAY_MS];
/** Page 1 has no cursor to anchor to, so its bound comes from the clock. Quantised so
 *  it does not mint a fresh query hash on every render. */
const WINDOW_ANCHOR_QUANTUM_MS = 60 * 60 * 1000;
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
      createdAfter: options.createdAfter ?? undefined,
    },
    options.channelId,
  );

const normalizeIdentity = (value: string | null | undefined): string =>
  (value ?? '').replace(/^user:/, '');

/** The filter values this search actually pushed down into the Vespa query. */
interface VespaPushdownFilters {
  boardId: string | undefined;
  priority: string | undefined;
  assignee: string | undefined;
  createdBy: string | undefined;
  userGroup: string | undefined;
  tags: string | undefined;
  stage: string | undefined;
}

// True when some active filter could NOT be expressed in the Vespa query, so its rows
// would come back unfiltered on that dimension.
//
// Rows returned by Vespa are now rendered exactly as received, with no client-side
// re-filtering. Re-checking a filter here meant reading fields the `lean` document summary
// does not carry — userGroupId and ticketType arrive undefined — so every row failed the
// check and correct hits were silently dropped. Rather than re-filter against data we do
// not have, anything Vespa could not apply falls back to the Zero page, which queries the
// database and can filter on every column.
const hasFiltersVespaCannotApply = (
  filters: TicketFilters | undefined,
  pushdown: VespaPushdownFilters,
): boolean => {
  // Never sent to Vespa by this hook — only the Zero page can honour them.
  // (ticketTypes is absent on purpose: it is not indexed in Vespa either, but the Zero
  // overlay in overlaidDirectVespaPage applies it on top of the search results instead.)
  if (filters?.sourceChannels?.length) return true;
  // Sent only in representable cases (single board, non-inverted assignee, ...); when the
  // pushdown value is undefined the filter is active but absent from the query.
  if (filters?.boards?.length && !pushdown.boardId) return true;
  if (filters?.priority?.length && !pushdown.priority) return true;
  if (filters?.assignee?.length && !pushdown.assignee) return true;
  if (filters?.createdBy?.length && !pushdown.createdBy) return true;
  if (filters?.userGroups?.length && !pushdown.userGroup) return true;
  if (filters?.tags?.length && !pushdown.tags) return true;
  // Undefined here means the column stage and the stage filter do not intersect, so no
  // single `stage` value can express the constraint.
  if (filters?.stages?.length && !pushdown.stage) return true;
  return false;
};

export const useKanbanTicketsPage = (
  options: UseKanbanTicketsPageOptions,
): UseKanbanTicketsPageResult => {
  const [ticketsState, setTicketsState] = useState<TicketsState>({ queryKey: '', tickets: [] });
  const [fetchCursorState, setFetchCursorState] = useState<FetchCursorState | null>(null);
  // The page cursor is an INCLUSIVE createdAt bound (see kanbanTicketsPageV3), so the
  // boundary tie group is re-fetched and de-duplicated below. If a whole page is
  // nothing but already-seen rows the tie group is bigger than the page, and paging
  // would stall — widen the page until it clears.
  const [tieSlack, setTieSlack] = useState(0);
  /** Index into WINDOW_STEPS_MS; === length means "no window bound". */
  const [windowStep, setWindowStep] = useState(0);
  const windowAnchorRef = useRef<{ queryKey: string; anchor: number } | null>(null);
  // Mirrors ticketsState so the page merge can be computed in the effect body rather
  // than inside a setState updater (updaters must stay pure — StrictMode calls them twice).
  const ticketsStateRef = useRef<TicketsState>({ queryKey: '', tickets: [] });
  const [nextCursor, setNextCursor] = useState<KanbanCursor | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const isLoadingMoreRef = useRef(false);
  const overdueReferenceTimeRef = useRef<number | null>(null);
  // Already the final query: any quotes were typed into the search box, and the backend
  // reads exactness off them (`isExactMatch` in the Vespa searchService).
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
  // Send bare IDs - the backend expands to all identity forms for Vespa matching.
  const vespaAssignee =
    parsedAssignee &&
    parsedAssignee.ids.length > 0 &&
    !parsedAssignee.inverted &&
    !parsedAssignee.includeUnassigned
      ? parsedAssignee.ids.map(id => id.replace(/^(user:|group:|userGroup:)/, '')).join(',')
      : undefined;

  const vespaTags =
    options.filters?.tags && options.filters.tags.length > 0
      ? options.filters.tags.join(',')
      : undefined;

  const vespaUserGroup =
    options.filters?.userGroups && options.filters.userGroups.length > 0
      ? options.filters.userGroups.join(',')
      : undefined;

  // Send bare IDs - the backend expands to all identity forms for Vespa matching.
  const vespaCreatedBy =
    options.filters?.createdBy && options.filters.createdBy.length > 0
      ? options.filters.createdBy.map(id => id.replace(/^(user:|group:|userGroup:)/, '')).join(',')
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
      // Send bare ID - the backend expands to all identity forms for Vespa matching.
      const bareId = options.groupKey.replace(/^(user:|group:|userGroup:)/, '');
      return { assignee: bareId };
    }
    if (options.groupBy === 'status') {
      // Filter by the group's status value
      return { status: options.groupKey };
    }
    // For formField grouping, dynamic field tokens already handle it
    return {};
  })();

  // When searching, skip stage/status/groupBy filters - fetch all results and segregate in frontend.
  // For dynamic field grouping, keep the filters as-is.
  const isFormFieldGroupBy =
    typeof options.groupBy === 'object' && options.groupBy?.type === 'formField';
  const skipColumnFiltersForSearch = hasSearchTerm && !isFormFieldGroupBy;

  // Stage filter, pushed into the YQL the same way userGroup/tags are (the backend binds
  // each value as `stage contains @stage_N`, OR-ed together).
  //
  // A stage column pins its own stage, and the user's filter narrows which stages are
  // shown, so the real constraint is the intersection of the two. An empty intersection
  // means the column can hold nothing — that is not expressible as a `stage` value, so
  // vespaStage stays undefined and hasFiltersVespaCannotApply routes it to the Zero page
  // rather than sending no stage constraint at all (which would show every stage).
  const selectedStages = options.filters?.stages ?? [];
  const pinnedColumnStage =
    !skipColumnFiltersForSearch && options.columnType === 'stage' ? options.stageName : undefined;
  const effectiveStages = pinnedColumnStage
    ? selectedStages.length === 0 || selectedStages.includes(pinnedColumnStage)
      ? [pinnedColumnStage]
      : []
    : selectedStages;
  const vespaStage = effectiveStages.length > 0 ? effectiveStages.join(',') : undefined;

  // Declared after every pushdown value above, since it requires that each active filter
  // made it into the Vespa query — direct-Vespa rows are rendered without re-filtering.
  const shouldUseDirectVespaRows =
    requiresVespaTicketIds &&
    !hasZeroOnlyFilters(
      options.filters,
      options.zeroOnlyDynamicFieldIds,
      options.dynamicFieldDateRanges,
    ) &&
    !hasFiltersVespaCannotApply(options.filters, {
      boardId: effectiveVespaBoardId,
      priority: vespaPriority,
      assignee: vespaAssignee,
      createdBy: vespaCreatedBy,
      userGroup: vespaUserGroup,
      tags: vespaTags,
      stage: vespaStage,
    }) &&
    canRepresentGroupInVespa(options.groupBy, options.groupKey) &&
    !options.showOverdueOnly;

  // Create a search key that changes when the group context changes
  // This forces the search to re-trigger when switching views
  // When searching without column filters, use a shared key so all columns share one search call
  // Include filter values in the key so that filter changes trigger a new search
  const groupByKey =
    typeof options.groupBy === 'object'
      ? `${options.groupBy.type}:${options.groupBy.fieldId}`
      : String(options.groupBy ?? 'none');
  // Include ALL filter values in search key so all columns re-search when filters change
  // Previously this only included priority, assignee, tags, createdBy - missing boards, stages, etc.
  const filterKey = skipColumnFiltersForSearch
    ? JSON.stringify({
        priority: vespaPriority ?? '',
        assignee: vespaAssignee ?? '',
        tags: vespaTags ?? '',
        createdBy: vespaCreatedBy ?? '',
        userGroup: vespaUserGroup ?? '',
        stage: vespaStage ?? '',
        boards: options.filters?.boards ?? [],
        stages: options.filters?.stages ?? [],
        ticketTypes: options.filters?.ticketTypes ?? [],
        sourceChannels: options.filters?.sourceChannels ?? [],
        userGroups: options.filters?.userGroups ?? [],
        dynamicFields: options.filters?.dynamicFields ?? {},
        boardId: effectiveVespaBoardId ?? '',
        projectId: options.projectId ?? '',
      })
    : '';
  const vespaSearchKey = skipColumnFiltersForSearch
    ? `search:${groupByKey}:${filterKey}` // Shared key includes filters
    : `${groupByKey}:${options.groupKey ?? ''}:${options.stageName}`;

  const vespaTicketSearch = useVespaTicketSearch({
    searchTerm: trimmedSearchTerm,
    dynamicFieldValues: pageVespaTokens,
    enabled: requiresVespaTicketIds,
    limit: hasSearchTerm ? 400 : 200,
    fetchAllDynamicFieldMatches: true,
    maxFetchedResults: hasSearchTerm ? 800 : 400,
    searchKey: vespaSearchKey,
    ...(options.dynamicFieldDateRanges
      ? { dynamicFieldDateRanges: options.dynamicFieldDateRanges }
      : {}),
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(effectiveVespaBoardId ? { boardId: effectiveVespaBoardId } : {}),
    // Skip column filters when searching (will segregate in frontend)
    ...(!skipColumnFiltersForSearch && options.columnType === 'status'
      ? { status: options.stageName }
      : {}),
    // Column stage intersected with the user's stage filter (see vespaStage above).
    ...(vespaStage ? { stage: vespaStage } : {}),
    ...(vespaPriority ? { priority: vespaPriority } : {}),
    ...(vespaAssignee ? { assignee: vespaAssignee } : {}),
    ...(vespaTags ? { tags: vespaTags } : {}),
    ...(vespaCreatedBy ? { createdBy: vespaCreatedBy } : {}),
    ...(vespaUserGroup ? { userGroup: vespaUserGroup } : {}),
    // Skip group filters when searching (will segregate in frontend)
    ...(!skipColumnFiltersForSearch ? vespaGroupFilter : {}),
  });
  const directVespaPage = useMemo(() => {
    if (!shouldUseDirectVespaRows) return null;

    // When a new search is in progress, don't apply current filters to stale results
    // as they may not match (e.g., user added a filter while search was cached).
    // Return null to show loading state until fresh results arrive.
    if (vespaTicketSearch.isSearching) return null;

    let results = vespaTicketSearch.searchResults;
    if (!results) return null;

    // Filter by channelId if specified
    if (options.channelId) {
      results = results.filter(ticket => ticket.channelId === options.channelId);
    }

    // Render what Vespa returned. Every active filter was pushed down into the query
    // (shouldUseDirectVespaRows routes the rest to the Zero page), so re-filtering here
    // would only risk dropping correct rows on fields the lean summary omits.
    const filtered = results as KanbanTicketsPageRow[];

    // When searching without column filters, segregate by stage/status in frontend
    if (skipColumnFiltersForSearch) {
      const segregated = filtered.filter(ticket => {
        // Filter by column stage/status
        if (options.columnType === 'status' && (ticket.statusV2 as string) !== options.stageName) {
          return false;
        }
        if (options.columnType === 'stage' && ticket.stageName !== options.stageName) {
          return false;
        }

        // Filter by groupBy (assignee, priority, status)
        if (options.groupBy === 'assignee' && options.groupKey) {
          const ticketAssignee = normalizeIdentity(ticket.assignedTo);
          if (options.groupKey === 'Unassigned') {
            if (ticketAssignee) return false;
          } else {
            const groupAssignee = normalizeIdentity(options.groupKey);
            if (ticketAssignee !== groupAssignee) return false;
          }
        }
        if (options.groupBy === 'priority' && options.groupKey) {
          if (options.groupKey === 'No Priority') {
            if (ticket.priority) return false;
          } else {
            if ((ticket.priority as string) !== options.groupKey) return false;
          }
        }
        if (options.groupBy === 'status' && options.groupKey) {
          if ((ticket.statusV2 as string) !== options.groupKey) return false;
        }

        return true;
      });
      return segregated;
    }

    return filtered;
  }, [
    options.channelId,
    options.columnType,
    options.stageName,
    options.groupBy,
    options.groupKey,
    shouldUseDirectVespaRows,
    skipColumnFiltersForSearch,
    vespaTicketSearch.isSearching,
    vespaTicketSearch.searchResults,
  ]);
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
  const { start: _start, createdAfter: _createdAfter, ...queryKeyArgs } = basePageArgs;
  // queryKey identifies the filter set, not the page — the cursor and the window bound
  // both move as you scroll and must stay out of it.
  const queryKey = JSON.stringify(queryKeyArgs);
  const fetchCursor = fetchCursorState?.queryKey === queryKey ? fetchCursorState.cursor : null;
  const tickets = ticketsState.queryKey === queryKey ? ticketsState.tickets : [];
  ticketsStateRef.current = ticketsState;

  if (windowAnchorRef.current?.queryKey !== queryKey) {
    windowAnchorRef.current = {
      queryKey,
      anchor: Math.ceil(Date.now() / WINDOW_ANCHOR_QUANTUM_MS) * WINDOW_ANCHOR_QUANTUM_MS,
    };
  }
  // The window hangs off the page cursor, so it descends with the scroll instead of
  // being pinned to a fixed date — a fixed floor would report a false end of list.
  const windowAnchor = fetchCursor?.createdAt ?? windowAnchorRef.current.anchor;
  const windowSpan = WINDOW_STEPS_MS[windowStep];
  const createdAfter = windowSpan === undefined ? null : windowAnchor - windowSpan;

  const pageArgs = buildKanbanTicketsPageArgs(
    {
      ...pageOptions,
      createdAfter,
      ...(tieSlack > 0 ? { pageSize: (options.pageSize ?? DEFAULT_PAGE_SIZE) + tieSlack } : {}),
    },
    fetchCursor,
  );
  const pageQuery = queries.kanbanTicketsPageV3(
    pageArgs as Parameters<typeof queries.kanbanTicketsPageV3>[0],
  );
  const [page, pageDetails] = useCachedQuery(pageQuery, {
    enabled:
      (options.enabled ?? true) &&
      !shouldUseDirectVespaRows &&
      (!requiresVespaTicketIds || vespaTicketSearch.searchResults !== null),
  });
  // Overlay live Zero fields onto direct-Vespa payload rows. Vespa is an async
  // search index, so a row's statusV2/stageName can lag a just-applied status
  // change; rendering that stale stage places the card in its OLD kanban column
  // (ticket 61697: status changed to B but card stays in A/C until reindex).
  // Hydrating the live stage/status by id from the Zero store keeps column
  // membership correct immediately, before Vespa catches up.
  const [liveDirectRows] = useCachedQuery(
    queries.ticketsByIds({
      ticketIds: shouldUseDirectVespaRows ? (vespaTicketIds ?? []) : [],
    }),
    { enabled: shouldUseDirectVespaRows && (vespaTicketIds?.length ?? 0) > 0 },
  );
  const liveDirectRowsById = useMemo(() => {
    const byId = new Map<string, Ticket>();
    for (const row of liveDirectRows ?? []) byId.set(row.id, row as Ticket);
    return byId;
  }, [liveDirectRows]);
  const overlaidDirectVespaPage = useMemo(() => {
    if (!shouldUseDirectVespaRows || directVespaPage === null) return directVespaPage;
    if (directVespaPage.length === 0) return directVespaPage;

    // ticketType is not indexed into Vespa, so it cannot be pushed down like the other
    // filters. It is applied here instead, against the live Zero row rather than the Vespa
    // payload — the same overlay that already corrects stage/status. Until those rows
    // arrive there is nothing to match on, so report loading rather than briefly rendering
    // the unfiltered Vespa set.
    const ticketTypes = options.filters?.ticketTypes ?? [];
    const filterByTicketType = ticketTypes.length > 0;
    if (liveDirectRowsById.size === 0) return filterByTicketType ? null : directVespaPage;

    const overlaid = directVespaPage.map(ticket => {
      const live = liveDirectRowsById.get(ticket.id);
      if (!live) return ticket;
      return {
        ...ticket,
        statusV2: live.statusV2,
        stageName: live.stageName,
        boardId: live.boardId,
        priority: live.priority,
        assignedTo: live.assignedTo,
        ticketType: live.ticketType,
      };
    });

    if (!filterByTicketType) return overlaid;
    // A row with no live counterpart has no type to test, so it cannot satisfy the filter.
    return overlaid.filter(
      ticket => liveDirectRowsById.has(ticket.id) && ticketTypes.includes(ticket.ticketType ?? ''),
    );
  }, [shouldUseDirectVespaRows, directVespaPage, liveDirectRowsById, options.filters?.ticketTypes]);

  const effectivePage = shouldUseDirectVespaRows ? overlaidDirectVespaPage : page;
  // Keyed off the page actually rendered, not directVespaPage: the overlay also returns
  // null while it waits for the Zero rows the ticketType filter is evaluated against, and
  // reporting 'complete' there would render an empty board instead of a loading state.
  const effectivePageDetailsType = shouldUseDirectVespaRows
    ? effectivePage === null
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
    setTieSlack(0);
    setWindowStep(0);
    isLoadingMoreRef.current = false;
  }, [queryKey, shouldUseDirectVespaRows]);

  const currentLimit = (options.pageSize ?? DEFAULT_PAGE_SIZE) + tieSlack;

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

    if (shouldUseDirectVespaRows || fetchCursor === null) {
      setTicketsState({ queryKey, tickets: pageRows });
      if (tieSlack !== 0) setTieSlack(0);
    } else {
      const prevState = ticketsStateRef.current;
      const previousTickets = prevState.queryKey === queryKey ? prevState.tickets : [];
      const combined = [...previousTickets, ...pageRows];
      // The cursor bound is inclusive, so the boundary tie group arrives again — drop
      // the rows we already hold.
      const unique = Array.from(new Map(combined.map(ticket => [ticket.id, ticket])).values());
      setTicketsState({ queryKey, tickets: unique });
      // A full page that adds nothing new means the boundary tie group is larger than
      // the page. Widen and re-fetch rather than looping on the same rows.
      if (unique.length === previousTickets.length && rawPageRows.length >= currentLimit) {
        setTieSlack(slack => (slack === 0 ? currentLimit : slack * 2));
      } else if (tieSlack !== 0) {
        setTieSlack(0);
      }
    }

    if (shouldUseDirectVespaRows) {
      setNextCursor(null);
      setHasMore(false);
      return;
    }

    // A short page means either the window is too narrow or we have genuinely reached
    // the end. Widen first; only the unbounded step is allowed to conclude.
    const full = rawPageRows.length >= currentLimit;
    if (!full && windowStep < WINDOW_STEPS_MS.length) {
      setWindowStep(step => step + 1);
      return;
    }
    setHasMore(full);

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
    currentLimit,
    tieSlack,
    windowStep,
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
    // Deliberately NOT resetting windowStep: it is sticky per column. A dense column
    // stays on the narrow window; a sparse one that had to widen keeps the wider one
    // instead of re-climbing the ladder on every page. Paying the widening probes once
    // is the difference between a 6.4x win and a 2.8x loss on thin columns.
    setFetchCursorState({ queryKey, cursor: nextCursor });
  }, [hasMore, nextCursor, queryKey]);

  const reset = useCallback(() => {
    setTicketsState({ queryKey, tickets: [] });
    setFetchCursorState(null);
    setNextCursor(null);
    setHasMore(true);
    setWindowStep(0);
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
