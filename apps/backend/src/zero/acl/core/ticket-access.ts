import type { Transaction } from '@rocicorp/zero';
import { ChannelVisibility, Schema, Ticket, WorkspaceRole } from '@xyne/shared';
import { zql } from '../../queries';
import { hasGuestTicketAccess } from './guest-access';
import type { QueryContext } from './types';

/**
 * "Can this user see this ticket" as ZQL: channel is PUBLIC, or the user participates.
 * Mutator reads are NOT filtered by the read ACLs, so mutators must apply this themselves.
 */
function accessibleTicketQuery(
  ticketId: string,
  actor: { sub: string; workspaceId: string },
): ReturnType<typeof zql.tickets.where> {
  return zql.tickets
    .where('id', ticketId)
    .where('workspaceId', actor.workspaceId)
    .whereExists('conversation', conversation => {
      return conversation.whereExists('channel', channel => {
        return channel.where(({ cmp, or, exists }) => {
          return or(
            cmp('visibility', ChannelVisibility.PUBLIC),
            exists('participants', participants => {
              return participants.where('userId', actor.sub);
            }),
          );
        });
      });
    });
}

// Guests are an explicit allow-list (guest_access + channel_participants), so PUBLIC alone
// must never grant them the ticket - same role branch as TicketAssignmentsACL.
export async function resolveAccessibleTicket(
  ticketId: string,
  ctx: QueryContext,
  tx: Transaction<Schema>,
): Promise<Ticket | undefined> {
  if (ctx.role === WorkspaceRole.GUEST) {
    const ticket = await tx.run(
      zql.tickets.where('id', ticketId).where('workspaceId', ctx.workspaceId).one(),
    );
    if (!ticket || !(await hasGuestTicketAccess(ctx, tx, ticket))) {
      return undefined;
    }
    return ticket;
  }

  return tx.run(
    accessibleTicketQuery(ticketId, { sub: ctx.userID, workspaceId: ctx.workspaceId }).one(),
  );
}
