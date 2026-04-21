import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class SubTicketsACL extends BaseACL<'sub_tickets'> {

  async canInsert(args: InsertValue<TableSchema<'sub_tickets'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Sub-ticket not in this workspace', 'sub_tickets');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'sub_tickets'>>, tx: Transaction<Schema>): Promise<void> {
    // Get existing subTicket to verify workspace
    const subTicket = await tx.run(zql.sub_tickets.where('id', args.id).one());
    if (!subTicket || subTicket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Sub-ticket not found in this workspace', 'sub_tickets');
    }

    const hasAccess = await tx.run(zql.ticket_sub_ticket_mappings
      .where('subTicketId', args.id)
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
      throw new MutationACLError('Sub-ticket update failed: you do not have access to the parent ticket', 'sub_tickets');
    }
  }

  async canDelete(_args: DeleteID<TableSchema<'sub_tickets'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Sub-ticket delete failed: sub-tickets cannot be deleted, use status changes instead', 'sub_tickets');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'sub_tickets'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Sub-ticket upsert failed: use insert or update operations separately', 'sub_tickets');
  }
}
