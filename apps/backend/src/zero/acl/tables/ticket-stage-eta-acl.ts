import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasGuestTicketAccess, isActiveConnectMember } from '../core/guest-access';

export class TicketStageEtaACL extends BaseACL<'ticket_stage_eta'> {

  private async verifyTicketInWorkspace(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    if (!ticket) throw new MutationACLError('Ticket stage ETA not found: ticket does not exist', 'ticket_stage_eta');
    // Slack-Connect: an active connect member of the ticket's (host) channel may mutate cross-org.
    if (await isActiveConnectMember(this.ctx, tx, ticket.channelId)) return;
    if (ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Ticket stage ETA not found in this workspace', 'ticket_stage_eta');
    }
    if (this.ctx.role === 'GUEST') {
      const hasAccess = await hasGuestTicketAccess(this.ctx, tx, ticket);
      if (!hasAccess) {
        throw new MutationACLError('Ticket stage ETA not accessible for guest users', 'ticket_stage_eta');
      }
      return;
    }

    // Gate on the ticket's own channel (PUBLIC or participant), matching TicketsACL's read
    // predicate and TicketAssignmentsACL — a workspace check alone would let any member of
    // the tenant write ETAs on tickets in private channels they cannot see.
    const accessible = await tx.run(
      zql.tickets
        .where('id', ticketId)
        .whereExists('channel', (channel) =>
          channel.where(({ or, cmp, exists }) =>
            or(
              cmp('visibility', ChannelVisibility.PUBLIC),
              exists('participants', (participants) => participants.where('userId', this.ctx.userID)),
            ),
          ),
        )
        .one(),
    );
    if (!accessible) {
      throw new MutationACLError('Ticket stage ETA failed: you do not have access to the ticket\'s channel', 'ticket_stage_eta');
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

  async canDelete(args: DeleteID<TableSchema<'ticket_stage_eta'>>, tx: Transaction<Schema>): Promise<void> {
    const eta = await tx.run(zql.ticket_stage_eta.where('id', args.id).one());
    if (eta) {
      await this.verifyTicketInWorkspace(eta.ticketId, tx);
    }
  }

  async canUpsert(args: UpsertValue<TableSchema<'ticket_stage_eta'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyTicketInWorkspace(args.ticketId, tx);
  }
}
