import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class CollectionItemsACL extends BaseACL<'collection_items'> {
  async canInsert(args: InsertValue<TableSchema<'collection_items'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'collection_items');
  }

  async canUpdate(args: UpdateValue<TableSchema<'collection_items'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.collection_items.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Collection item update failed: item does not exist', 'collection_items');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'collection_items');
  }

  async canDelete(args: DeleteID<TableSchema<'collection_items'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.collection_items.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Collection item delete failed: item does not exist', 'collection_items');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'collection_items');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'collection_items'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Collection item upsert failed: use insert or update separately', 'collection_items');
  }
}
