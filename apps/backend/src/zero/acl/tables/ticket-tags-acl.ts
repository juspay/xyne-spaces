import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasGuestTicketAccess, isActiveConnectMember } from '../core/guest-access';

export class TicketTagsACL extends BaseACL<'ticket_tags'> {

  private async verifyTicketInWorkspace(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    if (!ticket) throw new MutationACLError('Ticket tag not found: ticket does not exist', 'ticket_tags');
    // Slack-Connect: an active connect member of the ticket's (host) channel may mutate cross-org.
    if (await isActiveConnectMember(this.ctx, tx, ticket.channelId)) return;
    if (ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Ticket tag not found in this workspace', 'ticket_tags');
    }
  }

  // Slack-Connect: is the caller an active connect member of the given ticket's (host) channel?
  private async isConnectMemberOfTicket(ticketId: string, tx: Transaction<Schema>): Promise<boolean> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    return Boolean(ticket && (await isActiveConnectMember(this.ctx, tx, ticket.channelId)));
  }

  private async verifyGuestScope(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    if (!ticket) {
      throw new MutationACLError('Ticket tag failed: ticket does not exist', 'ticket_tags');
    }
    if (ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Ticket tag failed: not in this workspace', 'ticket_tags');
    }
    const hasAccess = await hasGuestTicketAccess(this.ctx, tx, ticket);
    if (!hasAccess) {
      throw new MutationACLError('Ticket tag failed: guest does not have access to this ticket', 'ticket_tags');
    }
  }

  private async resolveTicketIdFromTag(tagId: string, tx: Transaction<Schema>): Promise<string> {
    const tag = await tx.run(zql.ticket_tags.where('id', tagId).one());
    if (!tag) {
      throw new MutationACLError('Ticket tag failed: tag does not exist', 'ticket_tags');
    }
    return tag.ticketId;
  }

  async canInsert(args: InsertValue<TableSchema<'ticket_tags'>>, tx: Transaction<Schema>): Promise<void> {
    // Slack-Connect: an active connect member may tag the (host) channel's tickets cross-org.
    if (await this.isConnectMemberOfTicket(args.ticketId, tx)) {
      return;
    }
    if (this.ctx.role === 'GUEST') {
      await this.verifyGuestScope(args.ticketId, tx);
      return;
    }
    await this.verifyTicketInWorkspace(args.ticketId, tx);
    const ticket = await tx.run(zql.tickets
      .where('id', args.ticketId)
      .whereExists('conversation', (conversation) => {
        return conversation.whereExists('channel', (channel) => {
          return channel.where(({ cmp, or, exists, and }) => {
            return or(
              and(
                cmp('visibility', ChannelVisibility.PRIVATE),
                exists('participants', (participants) => {
                  return participants.where('userId', this.ctx.userID);
                })
              ),
              and(
                cmp('visibility', ChannelVisibility.PUBLIC),
                exists('project', (project) => {
                  return project.whereExists('channels', (channelQuery) => {
                    return channelQuery
                      .where('visibility', ChannelVisibility.PUBLIC)
                      .whereExists('participants', (participants) => {
                        return participants.where('userId', this.ctx.userID);
                      });
                  });
                })
              )
            );
          });
        });
      })
      .one());

    if (!ticket) {
      throw new MutationACLError('Ticket tag insert failed: you do not have access to the parent ticket', 'ticket_tags');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'ticket_tags'>>, tx: Transaction<Schema>): Promise<void> {
    const existingTag = await tx.run(zql.ticket_tags.where('id', args.id).one());
    // Slack-Connect: an active connect member of the ticket's (host) channel may mutate cross-org.
    if (existingTag && (await this.isConnectMemberOfTicket(existingTag.ticketId, tx))) {
      return;
    }
    if (this.ctx.role === 'GUEST') {
      const ticketId = await this.resolveTicketIdFromTag(args.id, tx);
      await this.verifyGuestScope(ticketId, tx);
      return;
    }
    const tag = await tx.run(zql.ticket_tags.where('id', args.id).one());
    if (tag) {
      await this.verifyTicketInWorkspace(tag.ticketId, tx);
    }
    const hasAccess = await tx.run(zql.ticket_tags
      .where('id', args.id)
      .whereExists('ticket', (ticket) => {
        return ticket.whereExists('conversation', (conversation) => {
          return conversation.whereExists('channel', (channel) => {
            return channel.where(({ cmp, or, exists, and }) => {
              return or(
                and(
                  cmp('visibility', ChannelVisibility.PRIVATE),
                  exists('participants', (participants) => {
                    return participants.where('userId', this.ctx.userID);
                  })
                ),
                and(
                  cmp('visibility', ChannelVisibility.PUBLIC),
                  exists('project', (project) => {
                    return project.whereExists('channels', (channelQuery) => {
                      return channelQuery
                        .where('visibility', ChannelVisibility.PUBLIC)
                        .whereExists('participants', (participants) => {
                          return participants.where('userId', this.ctx.userID);
                        });
                    });
                  })
                )
              );
            });
          });
        });
      })
      .one());

    if (!hasAccess) {
      throw new MutationACLError('Ticket tag update failed: you do not have access to the parent ticket', 'ticket_tags');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'ticket_tags'>>, tx: Transaction<Schema>): Promise<void> {
    const existingTag = await tx.run(zql.ticket_tags.where('id', args.id).one());
    // Slack-Connect: an active connect member of the ticket's (host) channel may mutate cross-org.
    if (existingTag && (await this.isConnectMemberOfTicket(existingTag.ticketId, tx))) {
      return;
    }
    if (this.ctx.role === 'GUEST') {
      const ticketId = await this.resolveTicketIdFromTag(args.id, tx);
      await this.verifyGuestScope(ticketId, tx);
      return;
    }
    // Verify user has access to the parent ticket before allowing deletion
    const tag = await tx.run(zql.ticket_tags.where('id', args.id).one());
    if (tag) {
      await this.verifyTicketInWorkspace(tag.ticketId, tx);
    }
    const hasAccess = await tx.run(zql.ticket_tags
      .where('id', args.id)
      .whereExists('ticket', (ticket) => {
        return ticket.whereExists('conversation', (conversation) => {
          return conversation.whereExists('channel', (channel) => {
            return channel.where(({ cmp, or, exists, and }) => {
              return or(
                and(
                  cmp('visibility', ChannelVisibility.PRIVATE),
                  exists('participants', (participants) => {
                    return participants.where('userId', this.ctx.userID);
                  })
                ),
                and(
                  cmp('visibility', ChannelVisibility.PUBLIC),
                  exists('project', (project) => {
                    return project.whereExists('channels', (channelQuery) => {
                      return channelQuery
                        .where('visibility', ChannelVisibility.PUBLIC)
                        .whereExists('participants', (participants) => {
                          return participants.where('userId', this.ctx.userID);
                        });
                    });
                  })
                )
              );
            });
          });
        });
      })
      .one());

    if (!hasAccess) {
      throw new MutationACLError('Ticket tag delete failed: you do not have access to the parent ticket', 'ticket_tags');
    }
  }

  async canUpsert(_args: UpsertValue<TableSchema<'ticket_tags'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Ticket tag upsert failed: use insert or update operations separately', 'ticket_tags');
  }
}
