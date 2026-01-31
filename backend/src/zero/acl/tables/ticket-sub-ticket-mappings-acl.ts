import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class TicketSubTicketMappingsACL extends BaseACL<'ticket_sub_ticket_mappings'> {

  async canInsert(args: InsertValue<TableSchema<'ticket_sub_ticket_mappings'>>, tx: Transaction<Schema>): Promise<void> {
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
      throw new MutationACLError('Ticket sub-ticket mapping insert failed: you do not have access to the parent ticket', 'ticket_sub_ticket_mappings');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'ticket_sub_ticket_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const hasAccess = await tx.run(zql.ticket_sub_ticket_mappings
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
      throw new MutationACLError('Ticket sub-ticket mapping update failed: you do not have access to the parent ticket', 'ticket_sub_ticket_mappings');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'ticket_sub_ticket_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const hasAccess = await tx.run(zql.ticket_sub_ticket_mappings
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
      throw new MutationACLError('Ticket sub-ticket mapping delete failed: you do not have access to the parent ticket', 'ticket_sub_ticket_mappings');
    }
  }

  async canUpsert(_args: UpsertValue<TableSchema<'ticket_sub_ticket_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Ticket sub-ticket mapping upsert failed: use insert or update operations separately', 'ticket_sub_ticket_mappings');
  }
}
