import { ChannelVisibility } from '@xyne/shared';
import { zql } from '../../queries';

/**
 * "Can this user see this ticket" as a ZQL predicate: the channel is PRIVATE with the
 * user as participant, or PUBLIC in a project the user has a public channel in.
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
        return channel.where(({ cmp, or, exists, and }) => {
          return or(
            and(
              cmp('visibility', ChannelVisibility.PRIVATE),
              exists('participants', participants => {
                return participants.where('userId', actor.sub);
              }),
            ),
            and(
              cmp('visibility', ChannelVisibility.PUBLIC),
              exists('project', project => {
                return project.whereExists('channels', channelQuery => {
                  return channelQuery
                    .where('visibility', ChannelVisibility.PUBLIC)
                    .whereExists('participants', participants => {
                      return participants.where('userId', actor.sub);
                    });
                });
              }),
            ),
          );
        });
      });
    });
}
