import { useCallback, useEffect, useRef, useState } from 'react';
import { searchService } from '../services/searchService';
import { useDebouncedValue } from './useDebouncedValue';
import { stripHighlightMarkup } from './useVespaTicketSearch';
import { logger, Event as LogEvent } from '../utils/logger';

export type ProjectTicketSearchResult = {
  id: string;
  title?: string;
  xyneId?: string | null;
};

// Vespa never pages past this offset, so stop asking.
const VESPA_PROJECT_TICKET_MAX_OFFSET = 1000;
const VESPA_PROJECT_TICKET_PAGE_SIZE = 200;
// EntitySelector fires onSearchChange on every keystroke.
const PROJECT_TICKET_SEARCH_DEBOUNCE_MS = 300;

interface UseProjectTicketSearchParams {
  projectId?: string | undefined;
  /** Only fetch while the dropdown that owns this search is open. */
  isActive: boolean;
}

interface UseProjectTicketSearchResult {
  tickets: ProjectTicketSearchResult[] | null;
  isLoading: boolean;
  hasMore: boolean;
  handleSearchChange: (searchValue: string) => void;
  handleScrollEnd: () => void;
  reset: () => void;
}

const fetchPage = async (
  projectId: string,
  query: string,
  offset: number,
): Promise<{
  results: ProjectTicketSearchResult[];
  totalCount: number;
  offset: number;
  limit: number;
}> => {
  const response = await searchService.vespaSearch({
    query: query || '*',
    type: 'tickets',
    apps: 'ticket',
    projectId,
    limit: VESPA_PROJECT_TICKET_PAGE_SIZE,
    offset,
  });

  return {
    results: response.results.map(result => ({
      id: result.id,
      title: stripHighlightMarkup(result.title),
      ...(result.searchContext?.xyneId !== undefined
        ? { xyneId: result.searchContext.xyneId ?? null }
        : {}),
    })),
    totalCount: response.totalCount,
    offset: response.offset,
    limit: response.limit,
  };
};

/** Paged Vespa search over a project's tickets, scoped to one dropdown. */
export const useProjectTicketSearch = ({
  projectId,
  isActive,
}: UseProjectTicketSearchParams): UseProjectTicketSearchResult => {
  const [tickets, setTickets] = useState<ProjectTicketSearchResult[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  // `search` drives the input; `debouncedSearch` drives the fetch, paging included.
  const debouncedSearch = useDebouncedValue(search, PROJECT_TICKET_SEARCH_DEBOUNCE_MS);
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
      if (!projectId) {
        return;
      }

      const normalizedQuery = debouncedSearch.trim();
      const requestId = ++requestIdRef.current;
      const isInitialLoad = replace || offset === 0;

      if (isInitialLoad) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const response = await fetchPage(projectId, normalizedQuery, offset);

        if (requestId !== requestIdRef.current) {
          return;
        }

        const rawNextOffset = response.offset + response.limit;
        const hasMorePages =
          response.results.length > 0 &&
          rawNextOffset < response.totalCount &&
          rawNextOffset < VESPA_PROJECT_TICKET_MAX_OFFSET;

        setTickets(previous => {
          const base = replace ? [] : (previous ?? []);
          return Array.from(
            new Map([...base, ...response.results].map(ticket => [ticket.id, ticket])).values(),
          );
        });
        setNextOffset(Math.min(rawNextOffset, VESPA_PROJECT_TICKET_MAX_OFFSET));
        setHasMore(hasMorePages);
      } catch (error) {
        if (requestId !== requestIdRef.current) {
          return;
        }

        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[useProjectTicketSearch] Failed to load Vespa project tickets'),
          context: [{ projectId, offset, query: normalizedQuery || '*', error }],
        });

        if (replace) {
          setTickets([]);
          setNextOffset(0);
        }

        setHasMore(false);
      } finally {
        // A superseded response must not clear a newer request's flag.
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [projectId, debouncedSearch],
  );

  // Re-query whenever the dropdown opens or the debounced term settles.
  useEffect(() => {
    if (!isActive || !projectId) {
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
  }, [isActive, projectId, debouncedSearch, loadPage]);

  useEffect(() => {
    reset();
  }, [projectId, reset]);

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

    if (nextOffset >= VESPA_PROJECT_TICKET_MAX_OFFSET) {
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
