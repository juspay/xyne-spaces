import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { searchService } from '../services/searchService';
import { useDebouncedValue } from './useDebouncedValue';
import { stripHighlightMarkup } from './useVespaTicketSearch';
import { logger, Event as LogEvent } from '../utils/logger';

export type SubTicketLinkCandidate = {
  id: string;
  title?: string;
  xyneId?: string | null;
  boardId?: string | null;
};

// Vespa never pages past this offset, so stop asking.
const VESPA_MAX_OFFSET = 1000;
const VESPA_PAGE_SIZE = 200;
// The search API rejects any filter carrying more values than this.
export const VESPA_MAX_BOARD_FILTER_VALUES = 50;
// EntitySelector fires onSearchChange on every keystroke.
const SEARCH_DEBOUNCE_MS = 300;

interface UseSubTicketLinkSearchParams {
  /** Comma-separated board ids to confine the search to; empty means every board. */
  boardIds?: string | undefined;
  /** Only fetch while the dropdown that owns this search is open. */
  isActive: boolean;
}

interface UseSubTicketLinkSearchResult {
  tickets: SubTicketLinkCandidate[] | null;
  isLoading: boolean;
  hasMore: boolean;
  handleSearchChange: (searchValue: string) => void;
  handleScrollEnd: () => void;
  reset: () => void;
}

const fetchPage = async (
  boardIds: string,
  query: string,
  offset: number,
): Promise<{
  results: SubTicketLinkCandidate[];
  totalCount: number;
  offset: number;
  limit: number;
}> => {
  const response = await searchService.vespaSearch({
    query: query || '*',
    type: 'tickets',
    apps: 'ticket',
    ...(boardIds ? { board: boardIds } : {}),
    limit: VESPA_PAGE_SIZE,
    offset,
  });

  return {
    results: response.results.map(result => ({
      id: result.id,
      title: stripHighlightMarkup(result.title),
      ...(result.searchContext?.xyneId !== undefined
        ? { xyneId: result.searchContext.xyneId ?? null }
        : {}),
      ...(result.searchContext?.boardId !== undefined
        ? { boardId: result.searchContext.boardId ?? null }
        : {}),
    })),
    totalCount: response.totalCount,
    offset: response.offset,
    limit: response.limit,
  };
};

/** Paged, workspace-wide ticket search behind the "+ Add existing sub-ticket" picker. */
export const useSubTicketLinkSearch = ({
  boardIds = '',
  isActive,
}: UseSubTicketLinkSearchParams): UseSubTicketLinkSearchResult => {
  const [tickets, setTickets] = useState<SubTicketLinkCandidate[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  // `search` drives the input; `debouncedSearch` drives the fetch, paging included.
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const [nextOffset, setNextOffset] = useState(0);
  // Bumped on every reset so a superseded response cannot overwrite newer results.
  const requestIdRef = useRef(0);

  const reset = useCallback((): void => {
    requestIdRef.current += 1;
    setTickets(null);
    setIsLoading(false);
    setIsLoadingMore(false);
    setHasMore(false);
    setSearch('');
    setNextOffset(0);
  }, []);

  const loadPage = useCallback(
    async (offset: number, replace: boolean): Promise<void> => {
      const normalizedQuery = debouncedSearch.trim();
      const requestId = ++requestIdRef.current;
      const isInitialLoad = replace || offset === 0;

      if (isInitialLoad) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const response = await fetchPage(boardIds, normalizedQuery, offset);

        if (requestId !== requestIdRef.current) {
          return;
        }

        const rawNextOffset = response.offset + response.limit;
        const hasMorePages =
          response.results.length > 0 &&
          rawNextOffset < response.totalCount &&
          rawNextOffset < VESPA_MAX_OFFSET;

        setTickets(previous => {
          const base = replace ? [] : (previous ?? []);
          return Array.from(
            new Map([...base, ...response.results].map(ticket => [ticket.id, ticket])).values(),
          );
        });
        setNextOffset(Math.min(rawNextOffset, VESPA_MAX_OFFSET));
        setHasMore(hasMorePages);
      } catch (error) {
        if (requestId !== requestIdRef.current) {
          return;
        }

        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[useSubTicketLinkSearch] Failed to load Vespa tickets'),
          context: [{ offset, query: normalizedQuery || '*', error }],
        });

        // EntitySelector has no error state - an empty list reads as "No results found".
        toast.error(isInitialLoad ? 'Failed to load tickets' : 'Failed to load more tickets', {
          id: 'sub-ticket-link-search-error',
        });

        // A paging failure keeps hasMore, so the next scroll-end retries this offset.
        if (isInitialLoad) {
          setTickets([]);
          setNextOffset(0);
          setHasMore(false);
        }
      } finally {
        // A superseded response must not clear a newer request's flag.
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [boardIds, debouncedSearch],
  );

  // Re-query whenever the dropdown opens or the debounced term settles.
  useEffect(() => {
    if (!isActive) {
      return;
    }

    setTickets(null);
    setNextOffset(0);
    setHasMore(false);

    if (debouncedSearch.trim()) {
      void loadPage(0, true);
    } else {
      // No request follows, so drop any in flight.
      requestIdRef.current += 1;
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [isActive, debouncedSearch, loadPage]);

  // Term only. Clearing results here would strand the dropdown: a term that round-trips
  // inside the debounce window settles unchanged, so the effect above never re-runs.
  const handleSearchChange = useCallback((searchValue: string): void => {
    setSearch(searchValue);
  }, []);

  // Derived, so it clears itself even when the term settles unchanged.
  const isSearchPending = isActive && search !== debouncedSearch;

  const handleScrollEnd = useCallback((): void => {
    if (!hasMore || isLoading || isLoadingMore || isSearchPending) {
      return;
    }

    if (nextOffset >= VESPA_MAX_OFFSET) {
      setHasMore(false);
      return;
    }

    void loadPage(nextOffset, false);
  }, [hasMore, isLoading, isLoadingMore, isSearchPending, loadPage, nextOffset]);

  return {
    tickets,
    isLoading: (isLoading || isSearchPending) && (!tickets || tickets.length === 0),
    hasMore,
    handleSearchChange,
    handleScrollEnd,
    reset,
  };
};
