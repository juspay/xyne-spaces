import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class RecurringCallSeriesACL extends BaseACL<'recurring_call_series'> {
  async canInsert(args: InsertValue<TableSchema<'recurring_call_series'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'recurring_call_series');
  }

  async canUpdate(args: UpdateValue<TableSchema<'recurring_call_series'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.recurring_call_series.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Recurring call series update failed: series does not exist', 'recurring_call_series');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'recurring_call_series');
  }

  async canDelete(args: DeleteID<TableSchema<'recurring_call_series'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.recurring_call_series.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Recurring call series delete failed: series does not exist', 'recurring_call_series');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'recurring_call_series');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'recurring_call_series'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Recurring call series upsert failed: use insert or update separately', 'recurring_call_series');
  }
}
