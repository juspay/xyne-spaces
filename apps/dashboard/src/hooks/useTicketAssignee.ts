import { useCallback } from 'react';
import { useZero } from './useZero';
import { useSelf } from './useUsers';
import { mutators } from '../zero/mutators';
import { surfaceMutationError } from '../utils/zeroMutationToast';
import { trackTicketOutcome } from '../services/Analytics/ticketTracking';

/**
 * `assignedTo` is stored either bare or prefixed (`user:<id>` / `group:<id>`).
 * Returns the user id for user assignments and null for group assignments —
 * a user picker cannot represent a group, and feeding it a group id makes the
 * trigger render a never-resolving placeholder instead of an honest "unassigned".
 */
export const resolveAssigneeId = (assignedTo: string | null | undefined): string | null => {
  if (!assignedTo || assignedTo.startsWith('group:')) return null;
  return assignedTo.replace(/^user:/, '') || null;
};

export function useTicketAssignee(ticketId: string): (userId: string | null) => void {
  const zero = useZero();
  const selfId = useSelf()?.id;

  return useCallback(
    (userId: string | null): void => {
      void surfaceMutationError(
        zero.mutate(
          mutators.ticket.update({ id: ticketId, assignedTo: userId, updatedAt: Date.now() }),
        ),
        'Failed to update assignee',
      ).then(ok => {
        if (ok) {
          trackTicketOutcome(
            'TICKET_ASSIGNED',
            { id: ticketId },
            {
              surface: 'list_inline',
              unassigned: !userId,
              selfAssigned: !!userId && userId === selfId,
            },
          );
        }
      });
    },
    [zero, ticketId, selfId],
  );
}
