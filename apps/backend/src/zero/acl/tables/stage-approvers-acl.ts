import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class StageApproversACL extends BaseACL<'stage_approvers'> {
  async canInsert(args: InsertValue<TableSchema<'stage_approvers'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'stage_approvers');
  }

  async canUpdate(args: UpdateValue<TableSchema<'stage_approvers'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.stage_approvers.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Stage approver update failed: approver does not exist', 'stage_approvers');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'stage_approvers');
  }

  async canDelete(args: DeleteID<TableSchema<'stage_approvers'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.stage_approvers.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Stage approver delete failed: approver does not exist', 'stage_approvers');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'stage_approvers');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'stage_approvers'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Stage approver upsert failed: use insert or update separately', 'stage_approvers');
  }
}
