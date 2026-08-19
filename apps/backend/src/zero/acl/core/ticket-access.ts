import { ChannelVisibility } from '@xyne/shared';
import { zql } from '../../queries';

/**
 * "Can this user see this ticket" as a ZQL predicate.
 *
 * A ticket is reachable when its conversation's channel is either PRIVATE with the
 * user as a participant, or PUBLIC inside a project the user already has a public
 * channel in.
 *
 * This lived inline in SubTicketsACL.canUpdate. It is shared now because reads
 * inside a Zero mutator are NOT filtered by the read ACLs — `zql` there is the bare
 * builder — so any mutator that reads a ticket the caller named must apply the
 * predicate itself or it becomes a way to pull data out of a channel the caller
 * cannot open. Keeping one copy stops the mutator and the ACL from drifting apart.
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
