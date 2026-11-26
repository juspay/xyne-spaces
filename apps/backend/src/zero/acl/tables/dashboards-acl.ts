import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { canEditDashboard } from '../core/dashboard-access';
import { zql } from '../../queries';

const TABLE = 'dashboards';

/** Owner and editors may change a dashboard; only the owner (creator) may delete it. */
export class DashboardsACL extends BaseACL<typeof TABLE> {
  private assertNewRow(args: { workspaceId?: unknown; createdBy?: unknown }) {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, TABLE);
    if (args.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Cannot create a dashboard for another user', TABLE);
    }
  }

  async canInsert(args: InsertValue<TableSchema<typeof TABLE>>, _tx: Transaction<Schema>): Promise<void> {
    this.assertNewRow(args);
  }

  async canUpdate(args: UpdateValue<TableSchema<typeof TABLE>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.dashboards.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Dashboard update failed: dashboard does not exist', TABLE);
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, TABLE);
    if (args.createdBy !== undefined && args.createdBy !== row.createdBy) {
      throw new MutationACLError('A dashboard owner cannot be changed', TABLE);
    }
    if (!(await canEditDashboard(this.ctx, row, tx))) {
      throw new MutationACLError('You do not have permission to edit this dashboard', TABLE);
    }
  }

  async canDelete(args: DeleteID<TableSchema<typeof TABLE>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.dashboards.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Dashboard delete failed: dashboard does not exist', TABLE);
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, TABLE);
    if (row.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Only the dashboard owner can delete it', TABLE);
    }
  }

  async canUpsert(args: UpsertValue<TableSchema<typeof TABLE>>, tx: Transaction<Schema>): Promise<void> {
    const existing = await tx.run(zql.dashboards.where('id', args.id).one());
    if (!existing) {
      this.assertNewRow(args);
      return;
    }
    assertWorkspaceMatch(this.ctx, existing.workspaceId, TABLE);
    if (args.createdBy !== existing.createdBy) {
      throw new MutationACLError('A dashboard owner cannot be changed', TABLE);
    }
    if (!(await canEditDashboard(this.ctx, existing, tx))) {
      throw new MutationACLError('You do not have permission to edit this dashboard', TABLE);
    }
  }
}
