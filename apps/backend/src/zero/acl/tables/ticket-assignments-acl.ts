import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasGuestTicketAccess } from '../core/guest-access';

export class TicketAssignmentsACL extends BaseACL<'ticket_assignments'> {

  private async verifyTicketInWorkspace(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    if (!ticket) throw new MutationACLError('Ticket assignment not found: ticket does not exist', 'ticket_assignments');
    if (ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Ticket assignment not found in this workspace', 'ticket_assignments');
    }
  }

  // Gate on the ticket's own channel (PUBLIC or participant), matching
  // TicketsACL's read predicate. Guests are gated on guest ticket access instead.
  private async verifyTicketAccess(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') {
      const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
      if (!ticket || !(await hasGuestTicketAccess(this.ctx, tx, ticket))) {
        throw new MutationACLError('Ticket assignment failed: guest does not have access to this ticket', 'ticket_assignments');
      }
      return;
    }
    const accessible = await tx.run(
      zql.tickets
        .where('id', ticketId)
        .whereExists('channel', (channel) =>
          channel.where(({ or, cmp, exists }) =>
            or(
              cmp('visibility', ChannelVisibility.PUBLIC),
              exists('participants', (participants) => participants.where('userId', this.ctx.userID))
            )
          )
        )
        .one()
    );
    if (!accessible) {
      throw new MutationACLError('Ticket assignment failed: you do not have access to the ticket\'s channel', 'ticket_assignments');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'ticket_assignments'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyTicketInWorkspace(args.ticketId, tx);
    await this.verifyTicketAccess(args.ticketId, tx);
    // Cannot create an assignment attributed to another user.
    if (args.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Ticket assignment insert failed: cannot attribute the assignment to another user', 'ticket_assignments');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'ticket_assignments'>>, tx: Transaction<Schema>): Promise<void> {
    const assignment = await tx.run(zql.ticket_assignments.where('id', args.id).one());
    if (!assignment) {
      throw new MutationACLError('Ticket assignment update failed: assignment does not exist', 'ticket_assignments');
    }
    await this.verifyTicketInWorkspace(assignment.ticketId, tx);
    await this.verifyTicketAccess(assignment.ticketId, tx);
    // Channel membership on the ticket (verifyTicketAccess above) is the
    // authorization boundary — any member of the ticket's channel may (re)assign it.
    // Not pinned to the assignment's creator, so collaborative reassignment is allowed.
  }

  async canDelete(args: DeleteID<TableSchema<'ticket_assignments'>>, tx: Transaction<Schema>): Promise<void> {
    const assignment = await tx.run(zql.ticket_assignments.where('id', args.id).one());
    if (!assignment) {
      throw new MutationACLError('Ticket assignment delete failed: assignment does not exist', 'ticket_assignments');
    }
    await this.verifyTicketInWorkspace(assignment.ticketId, tx);
    await this.verifyTicketAccess(assignment.ticketId, tx);
    // Channel membership on the ticket is the authorization boundary (see
    // canUpdate) — any member of the ticket's channel may remove an assignment as part of
    // reassignment; not pinned to the assignment's creator.
  }

  async canUpsert(args: UpsertValue<TableSchema<'ticket_assignments'>>, tx: Transaction<Schema>): Promise<void> {
    const existing = await tx.run(zql.ticket_assignments.where('id', args.id).one());
    if (!existing) {
      // Row doesn't exist yet → authorize as an INSERT.
      await this.verifyTicketInWorkspace(args.ticketId, tx);
      await this.verifyTicketAccess(args.ticketId, tx);
      if (args.createdBy !== this.ctx.userID) {
        throw new MutationACLError('Ticket assignment upsert failed: cannot attribute the assignment to another user', 'ticket_assignments');
      }
      return;
    }
    await this.verifyTicketInWorkspace(existing.ticketId, tx);
    await this.verifyTicketAccess(existing.ticketId, tx);
    // Membership on the ticket's channel is the authorization boundary; not
    // pinned to the assignment's creator (see canUpdate/canDelete).
  }
}
