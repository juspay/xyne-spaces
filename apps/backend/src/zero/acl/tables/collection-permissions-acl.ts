import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class CollectionPermissionsACL extends BaseACL<'collection_permissions'> {
  async canInsert(args: InsertValue<TableSchema<'collection_permissions'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'collection_permissions');
  }

  async canUpdate(args: UpdateValue<TableSchema<'collection_permissions'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.collection_permissions.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Collection permission update failed: permission does not exist', 'collection_permissions');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'collection_permissions');
  }

  async canDelete(args: DeleteID<TableSchema<'collection_permissions'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.collection_permissions.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Collection permission delete failed: permission does not exist', 'collection_permissions');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'collection_permissions');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'collection_permissions'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Collection permission upsert failed: use insert or update separately', 'collection_permissions');
  }
}
