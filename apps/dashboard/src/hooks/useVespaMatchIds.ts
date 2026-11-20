import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BaseTicketType } from '@xyne/shared';
import { searchService, type MatchIdsSearchFilters } from '../services/searchService';

// The gram fields hold 2-grams, so a shorter word can never match.
const MIN_SEARCH_LENGTH = 2;
const EMPTY: string[] = [];

type MatchIdsFilters = Omit<MatchIdsSearchFilters, 'target' | 'query' | 'fieldKey' | 'limit'>;

// Ticket types of the Zero queries the pickers pass the ids to.
export const TICKET_PICKER_FILTERS = {
  work: { excludeTicketTypes: [BaseTicketType.Release, BaseTicketType.Support] }, // ticketsSearch
  release: { ticketTypes: [BaseTicketType.Release] }, // releaseTicketsSearch
} satisfies Record<string, MatchIdsFilters>;

interface UseVespaMatchIdsParams {
  target: MatchIdsSearchFilters['target'];
  /** Already debounced search text. */
  search: string;
  fieldKey?: string;
  filters?: MatchIdsFilters;
  limit: number;
  enabled?: boolean;
}

/**
 * Ids of the docs whose `target` field contains every word of `search`, from Vespa.
 * The field is encrypted in Postgres, so Zero can't ILIKE it; callers pass these ids
 * to their Zero query (e.g. `titleMatchIds` of `ticketsSearch` / `releaseTicketsSearch`).
 */
export const useVespaMatchIds = ({
  target,
  search,
  fieldKey,
  filters,
  limit,
  enabled = true,
}: UseVespaMatchIdsParams): string[] => {
  const query = search.trim();
  const isSearchable = enabled && query.length >= MIN_SEARCH_LENGTH;
  const { data } = useQuery({
    queryKey: ['vespa-match-ids', target, fieldKey, filters, query, limit],
    enabled: isSearchable,
    queryFn: ({ signal }) =>
      searchService.searchMatchIds({ target, query, fieldKey, ...filters, limit }, signal),
    // Keep the last matches while the next word loads, so the list doesn't flash to xyneId-only.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  return isSearchable ? (data ?? EMPTY) : EMPTY;
};
