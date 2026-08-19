import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ReleaseAttributionsACL extends BaseACL<'release_attributions'> {
  // Resolve ticketId -> ticket (workspace) -> channel (PUBLIC-or-participant),
  // mirroring TicketAssignmentsACL.
  private async verifyTicketAccess(ticketId: string, tx: Transaction<Schema>): Promise<void> {
    const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
    if (!ticket || ticket.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Release attribution failed: ticket not found in this workspace', 'release_attributions');
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
      throw new MutationACLError('Release attribution failed: you do not have access to the ticket\'s channel', 'release_attributions');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'release_attributions'>>, tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'release_attributions');
    await this.verifyTicketAccess(args.ticketId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'release_attributions'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.release_attributions.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Release attribution update failed: attribution does not exist', 'release_attributions');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'release_attributions');
    // Gate on the stored row's ticket channel — non-participants of the private
    // channel must not tamper with the release attribution.
    await this.verifyTicketAccess(row.ticketId, tx);
    // ticketId can be repointed on update — re-verify access to the new ticket too.
    if (args.ticketId !== undefined) {
      await this.verifyTicketAccess(args.ticketId, tx);
    }
  }

  async canDelete(args: DeleteID<TableSchema<'release_attributions'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.release_attributions.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Release attribution delete failed: attribution does not exist', 'release_attributions');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'release_attributions');
    await this.verifyTicketAccess(row.ticketId, tx);
  }

  async canUpsert(_args: UpsertValue<TableSchema<'release_attributions'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Release attribution upsert failed: use insert or update separately', 'release_attributions');
  }
}
