import { useCallback } from 'react';
import { useZero } from './useZero';
import { useSelf } from './useUsers';
import { mutators } from '../zero/mutators';
import { surfaceMutationError } from '../utils/zeroMutationToast';
import { trackTicketOutcome } from '../services/Analytics/ticketTracking';

export interface AssigneeRef {
  /** Bare user id, or null when unassigned or assigned to a group. */
  userId: string | null;
  /** Bare group id, or null when a user assignee takes precedence. */
  groupId: string | null;
}

/**
 * A ticket's assignee lives in two columns: a user in `assignedTo` (bare id),
 * a group in `userGroupId` — except legacy rows, which still hold `group:<id>`
 * in `assignedTo`. A user assignee wins over a group.
 *
 * Mirrors TicketCard / TicketHoverCard so every surface agrees on what a ticket
 * is assigned to.
 */
export const resolveAssigneeRef = (
  assignedTo: string | null | undefined,
  userGroupId?: string | null,
): AssigneeRef => {
  const userId =
    assignedTo && !assignedTo.startsWith('group:')
      ? assignedTo.replace(/^user:/, '') || null
      : null;
  if (userId) return { userId, groupId: null };
  const groupId = assignedTo?.startsWith('group:')
    ? assignedTo.slice('group:'.length) || null
    : userGroupId || null;
  return { userId: null, groupId };
};

/**
 * Inline assignee mutation for ticket rows. Pass the ticket's resolved assignee
 * so unassigning clears whichever column is actually being displayed.
 */
export function useTicketAssignee(
  ticketId: string,
  assignee?: AssigneeRef,
): (userId: string | null) => void {
  const zero = useZero();
  const selfId = useSelf()?.id;
  const displaysUser = !!assignee?.userId;

  return useCallback(
    (userId: string | null): void => {
      // Assigning a user leaves any group in place — autoassignment boards keep
      // team + agent together. Unassigning clears whichever one is displayed;
      // '' clears userGroupId, since the mutator ignores null for it.
      const updates = userId
        ? { assignedTo: userId }
        : displaysUser
          ? { assignedTo: null }
          : { assignedTo: null, userGroupId: '' };
      void surfaceMutationError(
        zero.mutate(mutators.ticket.update({ id: ticketId, ...updates, updatedAt: Date.now() })),
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
    [zero, ticketId, selfId, displaysUser],
  );
}
