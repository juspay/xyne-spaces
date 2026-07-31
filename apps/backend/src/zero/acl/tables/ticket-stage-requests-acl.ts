import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class TicketStageRequestsACL extends BaseACL<'ticket_stage_requests'> {

  // Gate deletes on the ticket's own channel (PUBLIC or participant), mirroring
  // TicketAssignmentsACL.verifyTicketAccess / TicketsACL reads.
  private async verifyTicketAccess(ticketId: string, tx: Transaction<Schema>): Promise<void> {
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
      throw new MutationACLError('Ticket stage request delete failed: you do not have access to the ticket\'s channel', 'ticket_stage_requests');
    }
  }
  async canInsert(args: InsertValue<TableSchema<'ticket_stage_requests'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'ticket_stage_requests');
  }

  async canUpdate(args: UpdateValue<TableSchema<'ticket_stage_requests'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.ticket_stage_requests.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Ticket stage request update failed: request does not exist', 'ticket_stage_requests');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'ticket_stage_requests');
  }

  async canDelete(args: DeleteID<TableSchema<'ticket_stage_requests'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.ticket_stage_requests.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Ticket stage request delete failed: request does not exist', 'ticket_stage_requests');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'ticket_stage_requests');
    await this.verifyTicketAccess(row.ticketId, tx);
  }

  async canUpsert(args: UpsertValue<TableSchema<'ticket_stage_requests'>>, tx: Transaction<Schema>): Promise<void> {
    // On an existing row, require the stored row to belong to the caller's workspace
    // (mirrors canUpdate); on a new row, enforce the caller's workspace.
    const existing = await tx.run(zql.ticket_stage_requests.where('id', args.id).one());
    if (existing) {
      assertWorkspaceMatch(this.ctx, existing.workspaceId, 'ticket_stage_requests');
      return;
    }
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'ticket_stage_requests');
  }
}
