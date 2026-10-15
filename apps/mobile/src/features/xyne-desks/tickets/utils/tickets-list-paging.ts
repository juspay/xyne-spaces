import { TICKETS_MAX_PAGES, TICKETS_PAGE_SIZE } from '../constants';

export type TicketsListPagingInput = {
  /** Pages currently requested (window = PAGE_SIZE * pages, plus one sentinel row). */
  pages: number;
  /** Raw row count the query returned for that window, before client filtering. */
  receivedCount: number;
  /** Zero result state for the current args. */
  isComplete: boolean;
};

export type TicketsListPagingState = {
  hasMore: boolean;
  isLoadingMore: boolean;
  visibleLimit: number;
};

/**
 * Growing-window paging (same contract as channel tickets).
 * Ask for `PAGE_SIZE * pages + 1`; a full window means a sentinel / more rows.
 */
export function computeTicketsListPaging(input: TicketsListPagingInput): TicketsListPagingState {
  const pages = Math.max(1, Math.floor(input.pages));
  const visibleLimit = TICKETS_PAGE_SIZE * pages;
  const atCap = pages >= TICKETS_MAX_PAGES;

  if (!input.isComplete) {
    return {
      hasMore: !atCap,
      isLoadingMore: pages > 1,
      visibleLimit,
    };
  }

  const sentinelSeen = input.receivedCount > visibleLimit;
  return {
    hasMore: sentinelSeen && !atCap,
    isLoadingMore: false,
    visibleLimit,
  };
}

export function ticketsListLimitForPages(pages: number): number {
  return TICKETS_PAGE_SIZE * Math.max(1, Math.floor(pages)) + 1;
}

export function nextTicketsListPages(pages: number, paging: TicketsListPagingState): number {
  if (!paging.hasMore || paging.isLoadingMore) return pages;
  return Math.min(TICKETS_MAX_PAGES, Math.max(1, Math.floor(pages)) + 1);
}

/** Inbox / All Mail / dates thin the window — grow until a page fills or the cap. */
export function shouldAutoGrowTicketsList(
  visibleCount: number,
  hasClientThinningFilter: boolean,
  paging: TicketsListPagingState,
): boolean {
  if (!hasClientThinningFilter) return false;
  if (!paging.hasMore || paging.isLoadingMore) return false;
  return visibleCount < TICKETS_PAGE_SIZE;
}
