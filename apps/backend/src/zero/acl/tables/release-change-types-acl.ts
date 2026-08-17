import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ReleaseChangeTypesACL extends BaseACL<'release_change_types'> {
  async canInsert(args: InsertValue<TableSchema<'release_change_types'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'release_change_types');
  }

  async canUpdate(args: UpdateValue<TableSchema<'release_change_types'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.release_change_types.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Release change type update failed: change type does not exist', 'release_change_types');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'release_change_types');
  }

  async canDelete(args: DeleteID<TableSchema<'release_change_types'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.release_change_types.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Release change type delete failed: change type does not exist', 'release_change_types');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'release_change_types');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'release_change_types'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Release change type upsert failed: use insert or update separately', 'release_change_types');
  }
}
