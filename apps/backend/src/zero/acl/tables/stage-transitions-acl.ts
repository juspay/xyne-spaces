import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class StageTransitionsACL extends BaseACL<'stage_transitions'> {
  async canInsert(args: InsertValue<TableSchema<'stage_transitions'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'stage_transitions');
  }

  async canUpdate(args: UpdateValue<TableSchema<'stage_transitions'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.stage_transitions.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Stage transition update failed: transition does not exist', 'stage_transitions');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'stage_transitions');
  }

  async canDelete(args: DeleteID<TableSchema<'stage_transitions'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.stage_transitions.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Stage transition delete failed: transition does not exist', 'stage_transitions');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'stage_transitions');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'stage_transitions'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Stage transition upsert failed: use insert or update separately', 'stage_transitions');
  }
}
