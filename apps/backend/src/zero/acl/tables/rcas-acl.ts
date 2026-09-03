import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class RcasACL extends BaseACL<'rcas'> {
  // Resolve ticketId -> ticket (workspace) -> channel (PUBLIC-or-participant),
  // mirroring TicketAssignmentsACL.
  private async verifyTicketAccess(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    if (!ticket || ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('RCA failed: ticket not found in this workspace', 'rcas');
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
      throw new MutationACLError('RCA failed: you do not have access to the ticket\'s channel', 'rcas');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'rcas'>>, tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'rcas');
    await this.verifyTicketAccess(args.ticketId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'rcas'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.rcas.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('RCA update failed: RCA does not exist', 'rcas');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'rcas');
    // Gate on the stored row's ticket channel — non-participants of the ticket's
    // private channel must not tamper with the RCA.
    await this.verifyTicketAccess(row.ticketId, tx);
    // ticketId can be repointed on update — re-verify access to the new ticket.
    if (args.ticketId !== undefined) {
      await this.verifyTicketAccess(args.ticketId, tx);
    }
  }

  async canDelete(args: DeleteID<TableSchema<'rcas'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.rcas.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('RCA delete failed: RCA does not exist', 'rcas');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'rcas');
    await this.verifyTicketAccess(row.ticketId, tx);
  }

  async canUpsert(_args: UpsertValue<TableSchema<'rcas'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('RCA upsert failed: use insert or update separately', 'rcas');
  }
}
