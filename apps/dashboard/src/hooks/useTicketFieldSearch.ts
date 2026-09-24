import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { searchService } from '../services/searchService';
import { stripHighlightMarkup } from './useVespaTicketSearch';
import { useDebouncedValue } from './useDebouncedValue';

const TICKET_FIELD_SEARCH_DEBOUNCE_MS = 300;
const TICKET_FIELD_PAGE_SIZE = 20;
const TICKET_FIELD_MAX_OFFSET = 1000;

export interface TicketFieldSearchResult {
  id: string;
  title?: string;
  xyneId?: string | null;
  boardId?: string | null;
  assignedTo?: string;
}

interface UseTicketFieldSearchParams {
  /** Only fetch while the dropdown that owns this search is open. */
  isActive: boolean;
  /** Scope the search to a project; omit to search across the workspace. */
  projectId?: string | undefined;
}

interface UseTicketFieldSearchResult {
  results: TicketFieldSearchResult[];
  isLoading: boolean;
  hasMore: boolean;
  totalCount: number;
  /** Distinct boards present in the fetched result set ("N boards searched"). */
  boardsSearched: number;
  searchQuery: string;
  handleSearchChange: (searchValue: string) => void;
  handleScrollEnd: () => void;
}

const fetchPage = async (
  query: string,
  offset: number,
  projectId?: string,
): Promise<{
  results: TicketFieldSearchResult[];
  totalCount: number;
  offset: number;
  limit: number;
}> => {
  const response = await searchService.vespaSearch({
    query: query || '*',
    type: 'tickets',
    apps: 'ticket',
    ...(projectId ? { projectId } : {}),
    limit: TICKET_FIELD_PAGE_SIZE,
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
      ...(result.searchContext?.assignedTo ? { assignedTo: result.searchContext.assignedTo } : {}),
    })),
    totalCount: response.totalCount,
    offset: response.offset,
    limit: response.limit,
  };
};

/** Debounced, paged Vespa search over tickets, scoped to one dropdown instance. */
export const useTicketFieldSearch = ({
  isActive,
  projectId,
}: UseTicketFieldSearchParams): UseTicketFieldSearchResult => {
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, TICKET_FIELD_SEARCH_DEBOUNCE_MS);
  const [results, setResults] = useState<TicketFieldSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  // Bumped on every reset so a superseded response cannot overwrite newer results.
  const requestIdRef = useRef(0);

  const loadPage = useCallback(
    async (offset: number, replace: boolean): Promise<void> => {
      const requestId = ++requestIdRef.current;
      const isInitialLoad = replace || offset === 0;
      if (isInitialLoad) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const response = await fetchPage(debouncedSearch.trim(), offset, projectId);
        if (requestId !== requestIdRef.current) return;

        const rawNextOffset = response.offset + response.limit;
        setResults(previous => {
          const base = replace ? [] : previous;
          return Array.from(
            new Map([...base, ...response.results].map(ticket => [ticket.id, ticket])).values(),
          );
        });
        setTotalCount(response.totalCount);
        setNextOffset(Math.min(rawNextOffset, TICKET_FIELD_MAX_OFFSET));
        setHasMore(
          response.results.length > 0 &&
            rawNextOffset < response.totalCount &&
            rawNextOffset < TICKET_FIELD_MAX_OFFSET,
        );
      } catch {
        if (requestId !== requestIdRef.current) return;

        // The picker renders an empty list as "No results" — a toast keeps the failure visible.
        toast.error('Failed to search tickets', { id: 'ticket-field-search-error' });
        if (isInitialLoad) {
          setResults([]);
          setTotalCount(0);
          setNextOffset(0);
          setHasMore(false);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [debouncedSearch, projectId],
  );

  // Re-query whenever the dropdown opens or the debounced term settles.
  useEffect(() => {
    if (!isActive) return;

    setResults([]);
    setTotalCount(0);
    setNextOffset(0);
    setHasMore(false);
    void loadPage(0, true);
  }, [isActive, debouncedSearch, loadPage]);

  const handleScrollEnd = useCallback((): void => {
    if (!hasMore || isLoading || isLoadingMore) return;

    if (nextOffset >= TICKET_FIELD_MAX_OFFSET) {
      setHasMore(false);
      return;
    }

    void loadPage(nextOffset, false);
  }, [hasMore, isLoading, isLoadingMore, loadPage, nextOffset]);

  const boardsSearched = new Set(
    results.map(result => result.boardId).filter((boardId): boardId is string => !!boardId),
  ).size;

  return {
    results,
    isLoading,
    hasMore,
    totalCount,
    boardsSearched,
    searchQuery,
    handleSearchChange: setSearchQuery,
    handleScrollEnd,
  };
};
