import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ReleaseChangesACL extends BaseACL<'release_changes'> {
  async canInsert(args: InsertValue<TableSchema<'release_changes'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'release_changes');
  }

  async canUpdate(args: UpdateValue<TableSchema<'release_changes'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.release_changes.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Release change update failed: change does not exist', 'release_changes');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'release_changes');
  }

  async canDelete(args: DeleteID<TableSchema<'release_changes'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.release_changes.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Release change delete failed: change does not exist', 'release_changes');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'release_changes');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'release_changes'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Release change upsert failed: use insert or update separately', 'release_changes');
  }
}
