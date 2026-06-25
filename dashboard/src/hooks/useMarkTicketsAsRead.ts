import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { useZero } from './useZero';
import { useAuthContextValues } from './useAuth';
import { mutators } from '../zero/mutators';
import { logger, Event as LoggerEvent } from '../utils/logger';

export interface BulkMarkTicket {
  id: string;
  lastEmailAt: number;
  emailReads?: ReadonlyArray<{ userId: string; lastReadEmailAt: number }>;
}

export function useMarkTicketsAsRead(): {
  markAsRead: (tickets: ReadonlyArray<BulkMarkTicket>) => number;
  markAsUnread: (tickets: ReadonlyArray<BulkMarkTicket>) => number;
} {
  const { userID } = useAuthContextValues();
  const zero = useZero();

  const markAsRead = useCallback(
    (tickets: ReadonlyArray<BulkMarkTicket>): number => {
      const items: Array<{ id: string; ticketId: string }> = [];

      for (const ticket of tickets) {
        const userRow = (ticket.emailReads ?? []).find(r => r.userId === userID);

        if (userRow && userRow.lastReadEmailAt >= ticket.lastEmailAt) {
          continue;
        }

        items.push({ id: uuidv4(), ticketId: ticket.id });
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

  const markAsUnread = useCallback(
    (tickets: ReadonlyArray<BulkMarkTicket>): number => {
      const ticketIds: string[] = [];

      for (const ticket of tickets) {
        const userRow = (ticket.emailReads ?? []).find(r => r.userId === userID);

        if (!userRow || userRow.lastReadEmailAt < ticket.lastEmailAt) {
          continue;
        }

        ticketIds.push(ticket.id);
      }

      if (ticketIds.length === 0) {
        toast.success('Already up to date');
        return 0;
      }

      void zero
        .mutate(mutators.emailRead.bulkMarkAsUnread({ ticketIds }))
        .client.catch((err: unknown) => {
          logger.error(LoggerEvent.ZERO_MUTATION_ERROR, {
            hook: 'useMarkTicketsAsRead',
            mutator: 'emailRead.bulkMarkAsUnread',
            error: err instanceof Error ? err.message : String(err),
          });
          toast.error('Failed to mark some tickets as unread');
        });

      toast.success(
        `Marked ${ticketIds.length} ticket${ticketIds.length === 1 ? '' : 's'} as unread`,
      );
      return ticketIds.length;
    },
    [zero, userID],
  );

  return { markAsRead, markAsUnread };
}
