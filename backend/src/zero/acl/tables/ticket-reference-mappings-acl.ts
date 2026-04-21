import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class TicketReferenceMappingsACL extends BaseACL<'ticket_reference_mappings'> {

  private async verifyTicketInWorkspace(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    if (!ticket) throw new MutationACLError('Ticket reference mapping not found: ticket does not exist', 'ticket_reference_mappings');
    if (ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Ticket reference mapping not found in this workspace', 'ticket_reference_mappings');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'ticket_reference_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyTicketInWorkspace(args.sourceTicketId, tx);
    const ticket = await tx.run(zql.tickets
      .where('id', args.sourceTicketId)
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
      throw new MutationACLError('Ticket reference insert failed: you do not have access to the parent ticket', 'ticket_reference_mappings');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'ticket_reference_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(zql.ticket_reference_mappings.where('id', args.id).one());
    if (mapping) {
      await this.verifyTicketInWorkspace(mapping.sourceTicketId, tx);
    }
    const hasAccess = await tx.run(zql.ticket_reference_mappings
      .where('id', args.id)
      .whereExists('sourceTicket', (ticket) => {
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
      throw new MutationACLError('Ticket reference update failed: you do not have access to the parent ticket', 'ticket_reference_mappings');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'ticket_reference_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(zql.ticket_reference_mappings.where('id', args.id).one());
    if (mapping) {
      await this.verifyTicketInWorkspace(mapping.sourceTicketId, tx);
    }
    const hasAccess = await tx.run(zql.ticket_reference_mappings
      .where('id', args.id)
      .whereExists('sourceTicket', (ticket) => {
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
      throw new MutationACLError('Ticket reference delete failed: you do not have access to the parent ticket', 'ticket_reference_mappings');
    }
  }

  async canUpsert(_args: UpsertValue<TableSchema<'ticket_reference_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Ticket reference upsert failed: use insert or update operations separately', 'ticket_reference_mappings');
  }
}
