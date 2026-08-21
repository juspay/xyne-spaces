import { ChannelVisibility } from '@xyne/shared';
import { zql } from '../../queries';

/**
 * "Can this user see this ticket" as a ZQL predicate: the channel is PUBLIC, or the user
 * is a participant of it. Same ticket-channel access idiom as TicketAssignmentsACL and
 * RCAsACL — a PUBLIC channel needs no participation.
 *
 * Shared out of SubTicketsACL.canUpdate because reads inside a Zero mutator are NOT
 * filtered by the read ACLs, so mutators must apply it themselves.
 */
export function accessibleTicketQuery(
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
