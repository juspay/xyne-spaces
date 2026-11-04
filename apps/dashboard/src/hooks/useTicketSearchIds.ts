import { useQuery } from '@tanstack/react-query';
import { searchService } from '../services/searchService';

// Vespa ranks candidates; the Zero query keeps its own type filter and limit,
// so it needs headroom to still fill a page.
const TICKET_SEARCH_CANDIDATES = 100;

interface UseTicketSearchIdsResult {
  /** Ids of the matching tickets; undefined when there is no search term. */
  ticketIds: string[] | undefined;
  /** A search term is set and its matches have not arrived yet. */
  isSearching: boolean;
}

/**
 * Ticket ids matching `search`, from Vespa. Feed them to a Zero ticket query as
 * `ticketIds`, which reads the rows under the viewer's ACL.
 */
export function useTicketSearchIds(
  search: string,
  { enabled = true }: { enabled?: boolean } = {},
): UseTicketSearchIdsResult {
  const term = search.trim();
  const { data, isPending } = useQuery({
    queryKey: ['ticket-search-ids', term],
    queryFn: async ({ signal }) => {
      const response = await searchService.vespaSearch(
        {
          query: term,
          type: 'tickets',
          apps: 'ticket',
          limit: TICKET_SEARCH_CANDIDATES,
        },
        signal,
      );
      return response.results.map(result => result.id);
    },
    enabled: enabled && !!term,
  });

  if (!term) return { ticketIds: undefined, isSearching: false };
  return { ticketIds: data ?? [], isSearching: enabled && isPending };
}
