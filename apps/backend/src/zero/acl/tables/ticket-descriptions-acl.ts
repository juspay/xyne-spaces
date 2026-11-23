import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { MutationACLError, type TableSchema } from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasGuestTicketAccess } from '../core/guest-access';

export class TicketDescriptionsACL extends BaseACL<'ticket_descriptions'> {
  private async verifyWorkspaceAndChannelAccess(
    workspaceId: string,
    ticketId: string,
    tx: Transaction<Schema>,
  ): Promise<void> {
    if (workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Ticket description not found in this workspace', 'ticket_descriptions');
    }

    // Guests are gated on the ticket's own channel, not the channelId stamped on the row.
    if (this.ctx.role === 'GUEST') {
      const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
      if (!ticket || !(await hasGuestTicketAccess(this.ctx, tx, ticket))) {
        throw new MutationACLError('Ticket description access denied: guest does not have access to this ticket', 'ticket_descriptions');
      }
    }
  }

  async canInsert(args: InsertValue<TableSchema<'ticket_descriptions'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyWorkspaceAndChannelAccess(args.workspaceId, args.ticketId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'ticket_descriptions'>>, tx: Transaction<Schema>): Promise<void> {
    const existing = await tx.run(zql.ticket_descriptions.where('ticketId', args.ticketId).one());
    if (!existing) {
      throw new MutationACLError('Ticket description not found', 'ticket_descriptions');
    }
    await this.verifyWorkspaceAndChannelAccess(existing.workspaceId, existing.ticketId, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'ticket_descriptions'>>, tx: Transaction<Schema>): Promise<void> {
    const existing = await tx.run(zql.ticket_descriptions.where('ticketId', args.ticketId).one());
    if (!existing) {
      throw new MutationACLError('Ticket description not found', 'ticket_descriptions');
    }
    await this.verifyWorkspaceAndChannelAccess(existing.workspaceId, existing.ticketId, tx);
  }

  async canUpsert(args: UpsertValue<TableSchema<'ticket_descriptions'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyWorkspaceAndChannelAccess(args.workspaceId, args.ticketId, tx);
  }
}
