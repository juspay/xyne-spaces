import { CHANNEL_TICKETS_MAX_PAGES, CHANNEL_TICKETS_PAGE_SIZE } from '../constants';

export type ChannelTicketsPagingInput = {
  /** Pages currently requested (window = PAGE_SIZE * pages, plus one sentinel row). */
  pages: number;
  /** Raw row count the query returned for that window, before client filtering. */
  receivedCount: number;
  /** Zero result state for the current args. */
  isComplete: boolean;
};

export type ChannelTicketsPagingState = {
  /** More rows exist server-side and the cap has not been reached. */
  hasMore: boolean;
  /** A window growth is in flight. */
  isLoadingMore: boolean;
  /** Rows to render: the window without the sentinel row. */
  visibleLimit: number;
};

/**
 * Pure paging arithmetic for the growing-window model.
 *
 * `hasMore` is derived from the sentinel: asking for `PAGE_SIZE * pages + 1` rows and
 * receiving all of them means at least one more row exists. Before the query
 * completes for a grown window, `isLoadingMore` is true and `hasMore` is left as
 * "assume more" so the footer keeps its spinner instead of flashing empty.
 */
export function computeChannelTicketsPaging(
  input: ChannelTicketsPagingInput,
): ChannelTicketsPagingState {
  const pages = Math.max(1, Math.floor(input.pages));
  const visibleLimit = CHANNEL_TICKETS_PAGE_SIZE * pages;
  const atCap = pages >= CHANNEL_TICKETS_MAX_PAGES;

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

/** Next `pages` value for a load-more request; unchanged when nothing more can load. */
export function nextChannelTicketsPages(pages: number, paging: ChannelTicketsPagingState): number {
  if (!paging.hasMore || paging.isLoadingMore) return pages;
  return Math.min(CHANNEL_TICKETS_MAX_PAGES, Math.max(1, Math.floor(pages)) + 1);
}

/**
 * Whether a client-side filter (board) has thinned the visible rows enough that the
 * window should grow on its own, so a sparse board does not look empty while the
 * server still has rows. Bounded by the same cap as manual load-more.
 */
export function shouldAutoGrowForClientFilter(
  visibleCount: number,
  hasClientFilter: boolean,
  paging: ChannelTicketsPagingState,
): boolean {
  if (!hasClientFilter) return false;
  if (!paging.hasMore || paging.isLoadingMore) return false;
  return visibleCount < CHANNEL_TICKETS_PAGE_SIZE;
}
