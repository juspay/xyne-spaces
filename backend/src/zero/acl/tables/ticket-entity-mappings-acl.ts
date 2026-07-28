import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasGuestTicketAccess } from '../core/guest-access';

export class TicketEntityMappingsACL extends BaseACL<'ticket_entity_mappings'> {

  private async verifyTicketInWorkspace(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    if (!ticket) throw new MutationACLError('Ticket entity mapping not found: ticket does not exist', 'ticket_entity_mappings');
    if (ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Ticket entity mapping not found in this workspace', 'ticket_entity_mappings');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'ticket_entity_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyTicketInWorkspace(args.ticketId, tx);
    if (this.ctx.role === 'GUEST') {
      const guestTicket = await tx.run(zql.tickets.where('id', args.ticketId).one());
      if (!guestTicket || !(await hasGuestTicketAccess(this.ctx, tx, guestTicket))) {
        throw new MutationACLError('Ticket entity mapping insert failed: guest does not have access to the parent ticket', 'ticket_entity_mappings');
      }
      return;
    }
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
      throw new MutationACLError('Ticket entity mapping insert failed: you do not have access to the parent ticket', 'ticket_entity_mappings');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'ticket_entity_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(zql.ticket_entity_mappings.where('id', args.id).one());
    if (mapping) {
      await this.verifyTicketInWorkspace(mapping.ticketId, tx);
    }
    if (this.ctx.role === 'GUEST') {
      if (!mapping) {
        throw new MutationACLError('Ticket entity mapping update failed: mapping does not exist', 'ticket_entity_mappings');
      }
      const guestTicket = await tx.run(zql.tickets.where('id', mapping.ticketId).one());
      if (!guestTicket || !(await hasGuestTicketAccess(this.ctx, tx, guestTicket))) {
        throw new MutationACLError('Ticket entity mapping update failed: guest does not have access to the parent ticket', 'ticket_entity_mappings');
      }
      return;
    }
    const hasAccess = await tx.run(zql.ticket_entity_mappings
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
      throw new MutationACLError('Ticket entity mapping update failed: you do not have access to the parent ticket', 'ticket_entity_mappings');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'ticket_entity_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    // Verify user has access to the parent ticket before allowing deletion
    const mappingForWorkspace = await tx.run(zql.ticket_entity_mappings.where('id', args.id).one());
    if (mappingForWorkspace) {
      await this.verifyTicketInWorkspace(mappingForWorkspace.ticketId, tx);
    }
    if (this.ctx.role === 'GUEST') {
      if (!mappingForWorkspace) {
        throw new MutationACLError('Ticket entity mapping delete failed: mapping does not exist', 'ticket_entity_mappings');
      }
      const guestTicket = await tx.run(zql.tickets.where('id', mappingForWorkspace.ticketId).one());
      if (!guestTicket || !(await hasGuestTicketAccess(this.ctx, tx, guestTicket))) {
        throw new MutationACLError('Ticket entity mapping delete failed: guest does not have access to the parent ticket', 'ticket_entity_mappings');
      }
      return;
    }
    const hasAccess = await tx.run(zql.ticket_entity_mappings
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
      throw new MutationACLError('Ticket entity mapping delete failed: you do not have access to the parent ticket', 'ticket_entity_mappings');
    }
  }

  async canUpsert(_args: UpsertValue<TableSchema<'ticket_entity_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Ticket entity mapping upsert failed: use insert or update operations separately', 'ticket_entity_mappings');
  }
}
