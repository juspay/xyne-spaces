import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { CollectionRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class CollectionItemsACL extends BaseACL<'collection_items'> {
  // Enforce the owner-or-EDITOR gate for all visibilities. Permissions live on the
  // item's root collection.
  private async verifyCanEditItem(itemId: string, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.collection_items.where('id', itemId).one());
    if (!row) {
      throw new MutationACLError('Collection item write failed: item does not exist', 'collection_items');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'collection_items');
    const rootCollectionId = row.rootCollectionId ?? row.collectionId;
    const collection = await tx.run(zql.collections.where('id', rootCollectionId).one());
    if (!collection) {
      throw new MutationACLError('Collection item write failed: collection does not exist', 'collection_items');
    }
    if (collection.ownerId === this.ctx.userID) {
      return;
    }
    const permission = await tx.run(
      zql.collection_permissions
        .where('collectionId', rootCollectionId)
        .where('userId', this.ctx.userID)
        .one(),
    );
    if (!permission || permission.role === CollectionRole.VIEWER) {
      throw new MutationACLError('Collection item write failed: requires EDITOR or OWNER permission', 'collection_items');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'collection_items'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'collection_items');
  }

  async canUpdate(args: UpdateValue<TableSchema<'collection_items'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyCanEditItem(args.id, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'collection_items'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyCanEditItem(args.id, tx);
  }

  async canUpsert(_args: UpsertValue<TableSchema<'collection_items'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Collection item upsert failed: use insert or update separately', 'collection_items');
  }
}
