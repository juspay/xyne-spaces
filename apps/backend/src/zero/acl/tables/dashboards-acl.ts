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
    // Only the dashboard owner may modify it.
    if (row.createdBy && row.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Cannot modify a dashboard you did not create', 'dashboards');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'dashboards'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.dashboards.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Dashboard delete failed: dashboard does not exist', 'dashboards');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'dashboards');
    // Only the dashboard owner may delete it.
    if (row.createdBy && row.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Cannot delete a dashboard you did not create', 'dashboards');
    }
  }

  async canUpsert(args: UpsertValue<TableSchema<'dashboards'>>, tx: Transaction<Schema>): Promise<void> {
    // On an existing row require ownership; on a new row pin createdBy to the
    // caller and enforce the caller's workspace.
    const existing = await tx.run(zql.dashboards.where('id', args.id).one());
    if (existing) {
      assertWorkspaceMatch(this.ctx, existing.workspaceId, 'dashboards');
      if (existing.createdBy && existing.createdBy !== this.ctx.userID) {
        throw new MutationACLError('Cannot modify a dashboard you did not create', 'dashboards');
      }
      return;
    }
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'dashboards');
    if (args.createdBy && args.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Cannot create a dashboard for another user', 'dashboards');
    }
  }
}
