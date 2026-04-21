import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class TicketActivitiesACL extends BaseACL<'ticket_activities'> {

  private async verifyTicketInWorkspace(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    if (!ticket) throw new MutationACLError('Ticket activity not found: ticket does not exist', 'ticket_activities');
    if (ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Ticket activity not found in this workspace', 'ticket_activities');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'ticket_activities'>>, tx: Transaction<Schema>): Promise<void> {
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
      throw new MutationACLError('Ticket activity insert failed: you do not have access to the parent ticket', 'ticket_activities');
    }
  }

  async canUpdate(_args: UpdateValue<TableSchema<'ticket_activities'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Ticket activity update failed: activities are immutable audit records and cannot be modified', 'ticket_activities');
  }

  async canDelete(_args: DeleteID<TableSchema<'ticket_activities'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Ticket activity delete failed: activities are immutable audit records and cannot be deleted', 'ticket_activities');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'ticket_activities'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Ticket activity upsert failed: use insert operation only for new activities', 'ticket_activities');
  }
}
