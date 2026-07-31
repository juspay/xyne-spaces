import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { CollectionRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class CollectionsACL extends BaseACL<'collections'> {
  // Enforce the owner-or-EDITOR permission gate here for all visibilities.
  // Permissions live on the root collection.
  private async verifyCanEditCollection(collectionId: string, tx: Transaction<Schema>): Promise<void> {
    const collection = await tx.run(zql.collections.where('id', collectionId).one());
    if (!collection) {
      throw new MutationACLError('Collection write failed: collection does not exist', 'collections');
    }
    assertWorkspaceMatch(this.ctx, collection.workspaceId, 'collections');
    if (collection.ownerId === this.ctx.userID) {
      return;
    }
    const rootCollectionId = collection.rootCollectionId ?? collection.id;
    const permission = await tx.run(
      zql.collection_permissions
        .where('collectionId', rootCollectionId)
        .where('userId', this.ctx.userID)
        .one(),
    );
    if (!permission || permission.role === CollectionRole.VIEWER) {
      throw new MutationACLError('Collection write failed: requires EDITOR or OWNER permission', 'collections');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'collections'>>, tx: Transaction<Schema>): Promise<void> {
    // A folder (createFolder) carries a parentId and is authorized against the
    // parent/root collection's permissions. A brand-new root collection has no
    // parent and is authorized as a self-owned create.
    if (args.parentId) {
      const rootCollectionId = (args.rootCollectionId as string | undefined) ?? (args.parentId as string);
      await this.verifyCanEditCollection(rootCollectionId, tx);
      return;
    }
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'collections');
    if (args.ownerId && args.ownerId !== this.ctx.userID) {
      throw new MutationACLError('Collection insert failed: cannot create a collection for another user', 'collections');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'collections'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyCanEditCollection(args.id, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'collections'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyCanEditCollection(args.id, tx);
  }

  async canUpsert(_args: UpsertValue<TableSchema<'collections'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Collection upsert failed: use insert or update separately', 'collections');
  }
}
