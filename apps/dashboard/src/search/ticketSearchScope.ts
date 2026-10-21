/**
 * Search from a ticket screen: the screen's search button (or Cmd+F) opens the palette as a
 * ticket search within the screen's view. Plain Cmd+K stays the global search.
 */
import type { VespaSearchFilters } from '../types/search';
import type { queries } from '../zero/queries';

// ---------------------------------------------------------------------------------------------
// 1. What a ticket screen hands to search
// ---------------------------------------------------------------------------------------------

export interface TicketSearchView {
  /** The screen's title, shown as "View · <name>". */
  viewName: string;
  /** The view's filters Vespa can apply. */
  vespaFilters: TicketVespaFilters;
  /** The view's full filter set for Zero; null when Vespa alone can apply every filter. */
  zeroQueryArgs: TicketZeroQueryArgs | null;
}

/** The Vespa request params a view can fill. */
export type TicketVespaFilters = Pick<
  VespaSearchFilters,
  | 'projectId'
  | 'board'
  | 'in'
  | 'assignee'
  | 'from'
  | 'priority'
  | 'stage'
  | 'tags'
  | 'userGroup'
  | 'after'
  | 'before'
  | 'on'
  | 'dynamicFieldValues'
  | 'dynamicFieldDateRanges'
>;

/** The board's `tableTicketsPage` args, without what search fills per batch (ids, limit, cursor). */
export type TicketZeroQueryArgs = Omit<
  Parameters<typeof queries.tableTicketsPage>[0],
  'vespaTicketIds' | 'limit' | 'start'
>;

// ---------------------------------------------------------------------------------------------
// 2. How the screen and the search palette connect
// ---------------------------------------------------------------------------------------------

let readCurrentView: (() => TicketSearchView) | null = null;

/** The ticket screen registers how to read its current view. Returns the unregister function. */
export const registerTicketView = (read: () => TicketSearchView): (() => void) => {
  readCurrentView = read;
  return () => {
    // A newer screen may have registered since; only remove our own.
    if (readCurrentView === read) readCurrentView = null;
  };
};

/** The palette asks which view it's opened on; null when no ticket screen is open. */
export const getCurrentTicketView = (): TicketSearchView | null => readCurrentView?.() ?? null;

export const OPEN_TICKET_SEARCH_EVENT = 'xyne:open-ticket-search';

/** The screen's search button: open the ticket search. The app-level palette listens. */
export const openTicketSearch = (): void => {
  window.dispatchEvent(new CustomEvent(OPEN_TICKET_SEARCH_EVENT));
};

// ---------------------------------------------------------------------------------------------
// 3. Adding the view's filters to a search request
// ---------------------------------------------------------------------------------------------

/** Adds the view's filters to the request. A filter the user already set in the palette wins. */
export const addViewFiltersToRequest = (
  request: VespaSearchFilters,
  vespaFilters: TicketVespaFilters | null | undefined,
): void => {
  if (!vespaFilters) return;
  for (const [key, value] of Object.entries(vespaFilters) as Array<
    [keyof TicketVespaFilters, TicketVespaFilters[keyof TicketVespaFilters]]
  >) {
    if (isEmpty(value) || !isEmpty(request[key])) continue;
    Object.assign(request, { [key]: value });
  }
};

/** Nothing to send: missing, '', an empty list or an empty object. */
const isEmpty = (value: unknown): boolean => {
  if (value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object' && value !== null) return Object.keys(value).length === 0;
  return false;
};
