import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class TicketStageEtaACL extends BaseACL<'ticket_stage_eta'> {

  private async verifyTicketInWorkspace(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    if (!ticket) throw new MutationACLError('Ticket stage ETA not found: ticket does not exist', 'ticket_stage_eta');
    if (ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Ticket stage ETA not found in this workspace', 'ticket_stage_eta');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'ticket_stage_eta'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyTicketInWorkspace(args.ticketId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'ticket_stage_eta'>>, tx: Transaction<Schema>): Promise<void> {
    const eta = await tx.run(zql.ticket_stage_eta.where('id', args.id).one());
    if (!eta) {
      throw new MutationACLError('Ticket stage ETA update failed: record does not exist', 'ticket_stage_eta');
    }
    await this.verifyTicketInWorkspace(eta.ticketId, tx);
  }

  async canDelete(_args: DeleteID<TableSchema<'ticket_stage_eta'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Ticket stage ETA delete failed: ETA records are immutable', 'ticket_stage_eta');
  }
}
