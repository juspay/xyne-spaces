import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { useZero } from './useZero';
import { useAuthContextValues } from './useAuth';
import { mutators } from '../zero/mutators';
import { logger, Event as LoggerEvent } from '../utils/logger';

export interface BulkMarkTicket {
  id: string;
  emails?: ReadonlyArray<{ id: string; createdAt: number }>;
  emailReads?: ReadonlyArray<{ userId: string; lastReadEmailId: string }>;
}

export function useMarkTicketsAsRead(): {
  markAsRead: (tickets: ReadonlyArray<BulkMarkTicket>) => number;
} {
  const { userID } = useAuthContextValues();
  const zero = useZero();

  const markAsRead = useCallback(
    (tickets: ReadonlyArray<BulkMarkTicket>): number => {
      const items: Array<{ id: string; ticketId: string; lastReadEmailId: string }> = [];

      for (const ticket of tickets) {
        const emails = ticket.emails ?? [];
        if (emails.length === 0) continue;

        const latestEmailId = emails.reduce((latest, e) =>
          e.createdAt > latest.createdAt ? e : latest,
        ).id;

        const userRow = (ticket.emailReads ?? []).find(r => r.userId === userID);
        if (userRow?.lastReadEmailId === latestEmailId) continue;

        items.push({ id: uuidv4(), ticketId: ticket.id, lastReadEmailId: latestEmailId });
      }

      if (items.length === 0) {
        toast.success('Already up to date');
        return 0;
      }

      void zero
        .mutate(
          mutators.emailRead.bulkMarkAsRead({
            items,
            timestamp: Date.now(),
          }),
        )
        .client.catch((err: unknown) => {
          logger.error(LoggerEvent.ZERO_MUTATION_ERROR, {
            hook: 'useMarkTicketsAsRead',
            mutator: 'emailRead.bulkMarkAsRead',
            error: err instanceof Error ? err.message : String(err),
          });
          toast.error('Failed to mark some tickets as read');
        });

      toast.success(`Marked ${items.length} ticket${items.length === 1 ? '' : 's'} as read`);
      return items.length;
    },
    [zero, userID],
  );

  return { markAsRead };
}
