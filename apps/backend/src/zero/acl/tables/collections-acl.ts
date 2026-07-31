import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class CollectionsACL extends BaseACL<'collections'> {
  async canInsert(args: InsertValue<TableSchema<'collections'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'collections');
  }

  async canUpdate(args: UpdateValue<TableSchema<'collections'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.collections.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Collection update failed: collection does not exist', 'collections');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'collections');
  }

  async canDelete(args: DeleteID<TableSchema<'collections'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.collections.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Collection delete failed: collection does not exist', 'collections');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'collections');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'collections'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Collection upsert failed: use insert or update separately', 'collections');
  }
}
