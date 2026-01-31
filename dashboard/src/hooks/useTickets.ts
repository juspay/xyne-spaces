import { useMemo } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

export type Ticket = QueryResultType<typeof queries.allTickets>[number];

export interface UseTicketsResult {
  tickets: Ticket[];
  isLoading: boolean;
  error: string | null;
  totalCount: number;
}

export function useTickets(): UseTicketsResult {
  const [ticketsData, queryDetails] = useCachedQuery(queries.allTickets());

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

    // Success
    const rows = ticketsData ?? [];

    return {
      tickets: rows,
      isLoading: false,
      error: null,
      totalCount: rows.length,
    };
  }, [ticketsData, queryDetails]);

  return processed;
}
