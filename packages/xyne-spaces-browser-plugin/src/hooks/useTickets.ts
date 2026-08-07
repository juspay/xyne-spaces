/**
 * React hook for ticket operations.
 */

import { useState, useEffect, useCallback } from 'react';
import { getSdkClient } from '../lib/sdk-client';
import type { Ticket } from '@xyne/spaces-sdk';

interface UseTicketsReturn {
  tickets: Ticket[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateTicket: (
    ticketId: string,
    updates: { statusV2?: string; priority?: string }
  ) => Promise<void>;
}

export function useTickets(): UseTicketsReturn {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const sdk = await getSdkClient();
      const myTickets = await sdk.tickets.list({ viewMode: 'my-tickets' });

      // Sort by priority and updated time
      const priorityOrder: Record<string, number> = {
        CRITICAL: 0,
        HIGH: 1,
        MEDIUM: 2,
        LOW: 3,
      };

      const sorted = [...myTickets].sort((a, b) => {
        // Sort by priority first
        const aPriority = priorityOrder[a.priority || 'LOW'] ?? 4;
        const bPriority = priorityOrder[b.priority || 'LOW'] ?? 4;

        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }

        // Then by updated time
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });

      setTickets(sorted);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tickets';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateTicket = useCallback(
    async (
      ticketId: string,
      updates: { statusV2?: string; priority?: string }
    ) => {
      try {
        const sdk = await getSdkClient();
        await sdk.tickets.update(ticketId, updates as Parameters<typeof sdk.tickets.update>[1]);

        // Refresh the list to get updated data
        await fetchTickets();
      } catch (err) {
        console.error('Failed to update ticket:', err);
        throw err;
      }
    },
    []
  );

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  return {
    tickets,
    isLoading,
    error,
    refresh: fetchTickets,
    updateTicket,
  };
}
