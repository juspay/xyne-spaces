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
  }

  async canDelete(args: DeleteID<TableSchema<'queries'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.queries.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Query delete failed: query does not exist', 'queries');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'queries');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'queries'>>, _tx: Transaction<Schema>): Promise<void> {
    // TEMPORARY (workspaceId-non-optional PR): allow upsert without a per-table
    // tenant check so live callers don't break. The row's workspaceId is stamped
    // from trusted authData in the mutators, not client args. A proper canUpsert
    // (delegate to canInsert/canUpdate by row existence) lands in a follow-up PR.
    return;
  }
}
