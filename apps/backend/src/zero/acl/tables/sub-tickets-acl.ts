import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasGuestTicketAccess } from '../core/guest-access';

export class SubTicketsACL extends BaseACL<'sub_tickets'> {

  async canInsert(args: InsertValue<TableSchema<'sub_tickets'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Sub-ticket not in this workspace', 'sub_tickets');
    }
  }

  private async verifyGuestScope(subTicketId: string, tx: Transaction<Schema>): Promise<void> {
    const subTicket = await tx.run(zql.sub_tickets.where('id', subTicketId).related('mappedTicket').one());
    if (!subTicket) {
      throw new MutationACLError('Sub-ticket not found', 'sub_tickets');
    }
    const ticket = subTicket.mappedTicket;
    if (!ticket || ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Sub-ticket not found in this workspace', 'sub_tickets');
    }
    const hasAccess = await hasGuestTicketAccess(this.ctx, tx, ticket);
    if (!hasAccess) {
      throw new MutationACLError('Sub-ticket not accessible for guest users', 'sub_tickets');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'sub_tickets'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') {
      await this.verifyGuestScope(args.id, tx);
      // verifyGuestScope only covers the CURRENT mapping - re-pointing needs the new target.
      if (args.mappedTicketId) {
        const target = await tx.run(zql.tickets.where('id', args.mappedTicketId as string).one());
        if (!target || !(await hasGuestTicketAccess(this.ctx, tx, target))) {
          throw new MutationACLError('Sub-ticket not accessible for guest users', 'sub_tickets');
        }
      }
      return;
    }

    // Get existing subTicket to verify workspace
    const subTicket = await tx.run(zql.sub_tickets.where('id', args.id).one());
    if (!subTicket || subTicket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Sub-ticket not found in this workspace', 'sub_tickets');
    }

    // When mappedTicketId is being changed, verify the caller can access the new
    // target's channel and that it is in the same workspace.
    if (args.mappedTicketId) {
      const accessibleNewMapped = await tx.run(zql.tickets
        .where('id', args.mappedTicketId as string)
        .where('workspaceId', this.ctx.workspaceId)
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

      if (!accessibleNewMapped) {
        throw new MutationACLError('Sub-ticket update failed: you do not have access to the target mapped ticket\'s channel', 'sub_tickets');
      }
    }

    if (!subTicket.mappedTicketId) {
      return;
    }

    const mappedTicket = await tx.run(zql.sub_tickets
      .where('id', args.id)
      .whereExists('mappedTicket', (ticket) => {
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

    if (!mappedTicket) {
      throw new MutationACLError('Sub-ticket update failed: you do not have access to the sub-ticket channel', 'sub_tickets');
    }
  }

  async canDelete(_args: DeleteID<TableSchema<'sub_tickets'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Sub-ticket delete failed: sub-tickets cannot be deleted, use status changes instead', 'sub_tickets');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'sub_tickets'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Sub-ticket upsert failed: use insert or update operations separately', 'sub_tickets');
  }
}
