import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class QueriesACL extends BaseACL<'queries'> {
  async canInsert(args: InsertValue<TableSchema<'queries'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'queries');
  }

  async canUpdate(args: UpdateValue<TableSchema<'queries'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.queries.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Query update failed: query does not exist', 'queries');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'queries');
    // Only the saved-query owner may modify it.
    if (row.createdBy && row.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Cannot modify a saved query you did not create', 'queries');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'queries'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.queries.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Query delete failed: query does not exist', 'queries');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'queries');
    // Only the saved-query owner may delete it.
    if (row.createdBy && row.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Cannot delete a saved query you did not create', 'queries');
    }
  }

  async canUpsert(args: UpsertValue<TableSchema<'queries'>>, tx: Transaction<Schema>): Promise<void> {
    // On an existing row require ownership; on a new row pin createdBy to the
    // caller and enforce the caller's workspace.
    const existing = await tx.run(zql.queries.where('id', args.id).one());
    if (existing) {
      assertWorkspaceMatch(this.ctx, existing.workspaceId, 'queries');
      if (existing.createdBy && existing.createdBy !== this.ctx.userID) {
        throw new MutationACLError('Cannot modify a saved query you did not create', 'queries');
      }
      return;
    }
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'queries');
    if (args.createdBy && args.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Cannot create a saved query for another user', 'queries');
    }
  }
}
