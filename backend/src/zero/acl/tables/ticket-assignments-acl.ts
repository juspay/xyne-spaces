import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class TicketAssignmentsACL extends BaseACL<'ticket_assignments'> {

  private async verifyTicketInWorkspace(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    if (!ticket) throw new MutationACLError('Ticket assignment not found: ticket does not exist', 'ticket_assignments');
    if (ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Ticket assignment not found in this workspace', 'ticket_assignments');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'ticket_assignments'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyTicketInWorkspace(args.ticketId, tx);
    // Only project participants can assign responsibilities
    const isParticipant = await tx.run(
      zql.channels
        .where('projectId', (await tx.run(zql.tickets.where('id', args.ticketId).one()))?.projectId ?? '')
        .whereExists('participants', (participants) => participants.where('userId', this.ctx.userID))
        .one()
    );
    if (!isParticipant) {
      throw new MutationACLError('Ticket assignment insert failed: you must be a project participant', 'ticket_assignments');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'ticket_assignments'>>, tx: Transaction<Schema>): Promise<void> {
    const assignment = await tx.run(zql.ticket_assignments.where('id', args.id).one());
    if (!assignment) {
      throw new MutationACLError('Ticket assignment update failed: assignment does not exist', 'ticket_assignments');
    }
    await this.verifyTicketInWorkspace(assignment.ticketId, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'ticket_assignments'>>, tx: Transaction<Schema>): Promise<void> {
    const assignment = await tx.run(zql.ticket_assignments.where('id', args.id).one());
    if (!assignment) {
      throw new MutationACLError('Ticket assignment delete failed: assignment does not exist', 'ticket_assignments');
    }
    await this.verifyTicketInWorkspace(assignment.ticketId, tx);
  }
}
