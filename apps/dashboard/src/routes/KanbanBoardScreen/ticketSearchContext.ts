import type { TicketFilters } from '../../components/Tickets/TicketFilters/types';
import type {
  TicketSearchView,
  TicketVespaFilters,
  TicketZeroQueryArgs,
} from '../../search/ticketSearchScope';
import { parseAssigneeFilter } from '../../zero/queries';
import {
  getDynamicFieldScalarFilters,
  toQueryFilters,
  type KanbanTicketsPageBaseArgs,
} from './useKanbanTicketsPage';

export interface TicketScreenState {
  /** The header's title, shown as the view the search runs in. */
  viewName: string;
  viewMode: 'project' | 'board' | 'my-tickets' | 'workspace-view';
  filters: TicketFilters;
  projectId: string | undefined;
  /** Board from the route (`/projects/:projectId/:boardId`). */
  routeBoardId: string | undefined;
  userId: string | undefined;
  dynamicFieldVespaTokens: string[];
  dynamicFieldDateRanges: Record<string, { start?: number; end?: number }>;
  zeroOnlyDynamicFieldIds: string[];
  showOverdueOnly: boolean;
  /** The screen's ticket query scope, as the table view pages it. */
  ticketsQueryParams: Pick<
    KanbanTicketsPageBaseArgs,
    'viewMode' | 'projectId' | 'boardId' | 'excludeFlowSteps' | 'formEntityValueFieldIds'
  >;
}

/**
 * What a ticket screen's search sends: the filters Vespa can express, and — only when some
 * filter has no Vespa form — the screen's full filter set for Zero to apply to Vespa's hits.
 *
 * Status is never sent: the statuses are the kanban columns, not a filter. Group-by and layout
 * are display settings and never travel.
 */
export const buildTicketSearchView = (state: TicketScreenState): TicketSearchView => ({
  viewName: state.viewName,
  vespaFilters: buildVespaFilters(state),
  zeroQueryArgs: needsZero(state) ? buildZeroQueryArgs(state) : null,
});

// ---------------------------------------------------------------------------------------------
// Vespa
// ---------------------------------------------------------------------------------------------

const buildVespaFilters = (state: TicketScreenState): TicketVespaFilters => {
  const { filters } = state;
  return withoutEmpty({
    projectId: isProjectPage(state) ? state.projectId : undefined,
    board: csv(boardIds(state)),
    // Only the Source channels chip scopes by channel. A channel's Tickets tab shows every
    // ticket on its board, whichever channel raised it, so the board alone scopes it.
    in: csv(filters.sourceChannels),
    assignee: csv(assigneeIds(state)),
    from: csv(creatorIds(state)),
    priority: csv(filters.priority),
    stage: csv(filters.stages),
    tags: csv(filters.tags),
    userGroup: csv(filters.userGroups),
    ...createdDateParams(filters.createdDateStart, filters.createdDateEnd),
    dynamicFieldValues: state.dynamicFieldVespaTokens,
    dynamicFieldDateRanges: state.dynamicFieldDateRanges,
  });
};

/** A project or board page limits results to its project; My tickets and saved views don't. */
const isProjectPage = (state: TicketScreenState): boolean =>
  state.viewMode === 'project' || state.viewMode === 'board';

/** Boards picked in the filter win; the board in the URL is only the fallback (the screen's rule). */
const boardIds = (state: TicketScreenState): string[] => {
  if (state.filters.boards?.length) return state.filters.boards;
  return state.routeBoardId ? [state.routeBoardId] : [];
};

/** Picked assignees — plus me when only "Assigned to me" is on. */
const assigneeIds = (state: TicketScreenState): string[] => {
  const ids = isAssigneeFilterVespaReady(state.filters)
    ? parsedAssignee(state.filters).ids.map(bareId)
    : [];
  return onlyAssignedToMe(state.filters) && state.userId ? [...ids, state.userId] : ids;
};

/** Picked creators — plus me when only "Created by me" is on. */
const creatorIds = (state: TicketScreenState): string[] => {
  const ids = (state.filters.createdBy ?? []).map(bareId);
  return onlyCreatedByMe(state.filters) && state.userId ? [...ids, state.userId] : ids;
};

// ---------------------------------------------------------------------------------------------
// Zero
// ---------------------------------------------------------------------------------------------

/**
 * Whether some active filter has no Vespa form, so Vespa's hits need Zero to finish the job.
 * Mirrors the board's own split (`hasZeroOnlyFilters` / `hasFiltersVespaCannotApply` in
 * useKanbanTicketsPage), except created dates, which search sends as `after`/`before`.
 */
const needsZero = (state: TicketScreenState): boolean => {
  const { filters } = state;
  return (
    meansAssignedOrCreatedByMe(state) ||
    !isAssigneeFilterVespaReady(filters) ||
    filters.dueDateStart !== undefined ||
    filters.dueDateEnd !== undefined ||
    Boolean(filters.roleAssignments?.some(role => role.userIds.length > 0)) ||
    Boolean(filters.ticketTypes?.length) ||
    Boolean(filters.merchantIds?.length) ||
    state.showOverdueOnly ||
    hasZeroOnlyCustomField(state)
  );
};

/** The same args the board's own page query gets, so Zero filters exactly like the board. */
const buildZeroQueryArgs = (state: TicketScreenState): TicketZeroQueryArgs => {
  const query = state.ticketsQueryParams;
  return {
    viewMode: query.viewMode,
    projectId: query.projectId,
    boardId: query.boardId,
    excludeFlowSteps: query.excludeFlowSteps,
    groupBy: 'none' as const,
    dynamicFieldScalarFilters: getDynamicFieldScalarFilters(
      state.filters,
      state.zeroOnlyDynamicFieldIds,
    ),
    filters: toQueryFilters(state.filters),
    formEntityValueFieldIds: query.formEntityValueFieldIds,
    showOverdueOnly: state.showOverdueOnly,
    overdueReferenceTime: state.showOverdueOnly ? ceilToMinute(Date.now()) : undefined,
  };
};

/**
 * "Assigned to or created by me" — an OR across two fields, which Vespa can't express. It's
 * My tickets' default (neither toggle on) and what both toggles together mean anywhere.
 */
const meansAssignedOrCreatedByMe = (state: TicketScreenState): boolean => {
  const { assigned, created } = state.filters;
  const exactlyOne = Boolean(assigned) !== Boolean(created);
  return state.viewMode === 'my-tickets' ? !exactlyOne : Boolean(assigned && created);
};

/** Custom-field filters Vespa has no form for: listed as Zero-only, or a scalar non-date value. */
const hasZeroOnlyCustomField = (state: TicketScreenState): boolean => {
  const zeroOnly = new Set(state.zeroOnlyDynamicFieldIds);
  return Object.entries(state.filters.dynamicFields ?? {}).some(
    ([fieldId, value]) =>
      zeroOnly.has(fieldId) ||
      (!Array.isArray(value) && !(fieldId in state.dynamicFieldDateRanges)),
  );
};

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

const parsedAssignee = (filters: TicketFilters): ReturnType<typeof parseAssigneeFilter> =>
  parseAssigneeFilter(filters.assignee ?? []);

/** Vespa can take real assignee ids, but not "unassigned" or an inverted ("is not") pick. */
const isAssigneeFilterVespaReady = (filters: TicketFilters): boolean => {
  if (!filters.assignee?.length) return true;
  const { inverted, includeUnassigned } = parsedAssignee(filters);
  return !inverted && !includeUnassigned;
};

const onlyAssignedToMe = (filters: TicketFilters): boolean =>
  Boolean(filters.assigned) && !filters.created;

const onlyCreatedByMe = (filters: TicketFilters): boolean =>
  Boolean(filters.created) && !filters.assigned;

const bareId = (id: string): string => id.replace(/^(user:|group:|userGroup:)/, '');

const ceilToMinute = (timestamp: number): number => Math.ceil(timestamp / 60000) * 60000;

/** A list as Vespa's comma-separated param; nothing when the list is empty. */
const csv = (values: readonly string[] | undefined): string | undefined =>
  values?.length ? values.join(',') : undefined;

/** The Vespa filters while they're being built: any param may still be missing. */
type VespaFiltersDraft = { [K in keyof TicketVespaFilters]?: TicketVespaFilters[K] | undefined };

/** Drops params with no value (missing, '', empty list, empty object) so none is sent blank. */
const withoutEmpty = (draft: VespaFiltersDraft): TicketVespaFilters =>
  Object.fromEntries(
    Object.entries(draft).filter(([, value]) => {
      if (value === undefined || value === '') return false;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object' && value !== null) return Object.keys(value).length > 0;
      return true;
    }),
  ) as TicketVespaFilters;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar day as YYYY-MM-DD, the date format the search params take. */
const toDay = (ms: number): string => {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
};

/**
 * The board's inclusive created-date range as Vespa params. The backend reads `after` as "after
 * the end of that day" and `before` as "before its start", so each bound moves out by a day; a
 * single day goes as `on`, since equal after/before bounds would match nothing.
 */
const createdDateParams = (
  start: number | undefined,
  end: number | undefined,
): Pick<TicketVespaFilters, 'after' | 'before' | 'on'> => {
  if (start !== undefined && end !== undefined && toDay(start) === toDay(end)) {
    return { on: toDay(start) };
  }
  return {
    ...(start !== undefined ? { after: toDay(start - DAY_MS) } : {}),
    ...(end !== undefined ? { before: toDay(end + DAY_MS) } : {}),
  };
};
