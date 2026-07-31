import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class DashboardsACL extends BaseACL<'dashboards'> {
  async canInsert(args: InsertValue<TableSchema<'dashboards'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'dashboards');
  }

  async canUpdate(args: UpdateValue<TableSchema<'dashboards'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.dashboards.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Dashboard update failed: dashboard does not exist', 'dashboards');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'dashboards');
  }

  async canDelete(args: DeleteID<TableSchema<'dashboards'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.dashboards.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Dashboard delete failed: dashboard does not exist', 'dashboards');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'dashboards');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'dashboards'>>, _tx: Transaction<Schema>): Promise<void> {
    // TEMPORARY (workspaceId-non-optional PR): allow upsert without a per-table
    // tenant check so live callers don't break. The row's workspaceId is stamped
    // from trusted authData in the mutators, not client args. A proper canUpsert
    // (delegate to canInsert/canUpdate by row existence) lands in a follow-up PR.
    return;
  }
}
