import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class CoesACL extends BaseACL<'coes'> {
  // Resolve rcaId -> rca (workspace) -> its ticket's channel (PUBLIC-or-participant),
  // mirroring TicketAssignmentsACL.
  private async verifyRcaAccess(rcaId: string, tx: Transaction<Schema>): Promise<void> {
    const rca = await tx.run(zql.rcas.where('id', rcaId).one());
    if (!rca || rca.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('COE failed: RCA not found in this workspace', 'coes');
    }
    const accessible = await tx.run(
      zql.tickets
        .where('id', rca.ticketId)
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
      throw new MutationACLError('COE failed: you do not have access to the RCA ticket\'s channel', 'coes');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'coes'>>, tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'coes');
    await this.verifyRcaAccess(args.rcaId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'coes'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.coes.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('COE update failed: COE does not exist', 'coes');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'coes');
    // Gate on the stored row's RCA/ticket channel — non-participants of the private
    // channel must not tamper with the COE.
    await this.verifyRcaAccess(row.rcaId, tx);
    // rcaId can be repointed on update — re-verify access to the new RCA too.
    if (args.rcaId !== undefined) {
      await this.verifyRcaAccess(args.rcaId, tx);
    }
  }

  async canDelete(args: DeleteID<TableSchema<'coes'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.coes.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('COE delete failed: COE does not exist', 'coes');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'coes');
    await this.verifyRcaAccess(row.rcaId, tx);
  }

  async canUpsert(_args: UpsertValue<TableSchema<'coes'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('COE upsert failed: use insert or update separately', 'coes');
  }
}
