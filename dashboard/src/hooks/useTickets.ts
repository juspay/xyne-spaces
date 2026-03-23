import { useMemo } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

export type Ticket = NonNullable<QueryResultType<typeof queries.ticketById>>;

export interface UseTicketsResult {
  tickets: Ticket[];
  isLoading: boolean;
  error: string | null;
  totalCount: number;
}

/**
 * Hook to fetch a single ticket by ID
 * @param ticketId - The ID of the ticket to fetch
 * @returns Array containing the ticket (for backward compatibility)
 */
export function useTickets(ticketId: string): UseTicketsResult {
  const [ticketData, queryDetails] = useCachedQuery(queries.ticketById({ ticketId }));

  const processed = useMemo(() => {
    // Loading
    if (queryDetails.type === 'unknown') {
      return {
        tickets: [],
        isLoading: true,
        error: null,
        totalCount: 0,
      };
    }

    // Error
    if (queryDetails.type === 'error') {
      return {
        tickets: [],
        isLoading: false,
        error: JSON.stringify(queryDetails.error.details),
        totalCount: 0,
      };
    }

    // Success - wrap single ticket in array for backward compatibility
    const rows = ticketData ? [ticketData] : [];

    return {
      tickets: rows,
      isLoading: false,
      error: null,
      totalCount: rows.length,
    };
  }, [ticketData, queryDetails]);

  return processed;
}
