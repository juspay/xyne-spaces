import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
export class BookmarksACL extends BaseACL<'bookmarks'> {

  async canInsert(args: InsertValue<TableSchema<'bookmarks'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.userId !== this.ctx.userID) {
      throw new MutationACLError('Bookmark insert failed: you can only create bookmarks for yourself', 'bookmarks');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'bookmarks'>>, tx: Transaction<Schema>): Promise<void> {
    // Verify the bookmark exists and belongs to the current user
    const bookmark = await tx.run(zql.bookmarks
      .where('id', args.id)
      .one());

    if (!bookmark) {
      throw new MutationACLError('Bookmark update failed: bookmark does not exist', 'bookmarks');
    }

    if (bookmark.userId !== this.ctx.userID) {
      throw new MutationACLError('Bookmark update failed: you can only modify your own bookmarks', 'bookmarks');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'bookmarks'>>, tx: Transaction<Schema>): Promise<void> {
    const bookmark = await tx.run(zql.bookmarks
      .where('id', args.id)
      .one());

    if (!bookmark) {
      throw new MutationACLError('Bookmark delete failed: bookmark does not exist', 'bookmarks');
    }

    if (bookmark.userId !== this.ctx.userID) {
      throw new MutationACLError('Bookmark delete failed: you can only delete your own bookmarks', 'bookmarks');
    }
  }

  async canUpsert(_args: UpsertValue<TableSchema<'bookmarks'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Bookmark upsert failed: use insert or update operations separately', 'bookmarks');
  }
}
