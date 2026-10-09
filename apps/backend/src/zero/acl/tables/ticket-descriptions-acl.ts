import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { MutationACLError, type TableSchema } from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasGuestChannelAccess } from '../core/guest-access';

export class TicketDescriptionsACL extends BaseACL<'ticket_descriptions'> {
  private async verifyWorkspaceAndChannelAccess(
    workspaceId: string,
    channelId: string,
    tx: Transaction<Schema>,
  ): Promise<void> {
    if (workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Ticket description not found in this workspace', 'ticket_descriptions');
    }

    if (this.ctx.role === 'GUEST') {
      const hasAccess = await hasGuestChannelAccess(this.ctx, tx, channelId);
      if (!hasAccess) {
        throw new MutationACLError('Ticket description access denied: guest does not have access to this channel', 'ticket_descriptions');
      }
    }
  }

  async canInsert(args: InsertValue<TableSchema<'ticket_descriptions'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyWorkspaceAndChannelAccess(args.workspaceId, args.channelId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'ticket_descriptions'>>, tx: Transaction<Schema>): Promise<void> {
    const existing = await tx.run(zql.ticket_descriptions.where('ticketId', args.ticketId).one());
    if (!existing) {
      throw new MutationACLError('Ticket description not found', 'ticket_descriptions');
    }
    await this.verifyWorkspaceAndChannelAccess(existing.workspaceId, existing.channelId, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'ticket_descriptions'>>, tx: Transaction<Schema>): Promise<void> {
    const existing = await tx.run(zql.ticket_descriptions.where('ticketId', args.ticketId).one());
    if (!existing) {
      throw new MutationACLError('Ticket description not found', 'ticket_descriptions');
    }
    await this.verifyWorkspaceAndChannelAccess(existing.workspaceId, existing.channelId, tx);
  }

  async canUpsert(args: UpsertValue<TableSchema<'ticket_descriptions'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyWorkspaceAndChannelAccess(args.workspaceId, args.channelId, tx);
  }
}
