import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { DashboardRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

// Per-instance ACL for the dashboards table.
// Dashboards are workspace-scoped directly (no channel intermediary like
// canvases) — matches the BoardAcl pattern of checking args.workspaceId
// against ctx.workspaceId.
//
// Insert : workspace match required.
// Update : workspace match required; fine-grained permission checks happen
//          inside the mutator (mirrors CanvasesACL.canUpdate behavior).
// Delete : createdBy may always delete; otherwise must be an OWNER
//          participant. Same pattern as CanvasesACL.canDelete.
export class DashboardsACL extends BaseACL<'dashboards'> {
  async canInsert(args: InsertValue<TableSchema<'dashboards'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Dashboard insert failed: workspace mismatch', 'dashboards');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'dashboards'>>, tx: Transaction<Schema>): Promise<void> {
    const dashboard = await tx.run(zql.dashboards.where('id', args.id).one());
    if (!dashboard) {
      throw new MutationACLError('Dashboard update failed: dashboard not found', 'dashboards');
    }
    if (dashboard.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Dashboard update failed: workspace mismatch', 'dashboards');
    }
    // Allow all dashboard updates here; the mutator enforces fine-grained
    // role-based permissions. Matches CanvasesACL.canUpdate.
  }

  // Upsert covers the legacy `dashboard.upsert` mutator (still used by the
  // existing analytics-dashboard / QueryBuilder screens). Fine-grained role
  // checks happen inside the mutator; we just enforce workspace scoping here
  // — matches the canInsert/canUpdate workspace-match policy.
  async canUpsert(args: UpsertValue<TableSchema<'dashboards'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Dashboard upsert failed: workspace mismatch', 'dashboards');
    }
    const existing = await tx.run(zql.dashboards.where('id', args.id).one());
    if (existing && existing.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Dashboard upsert failed: cannot move dashboard across workspaces', 'dashboards');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'dashboards'>>, tx: Transaction<Schema>): Promise<void> {
    const dashboard = await tx.run(zql.dashboards.where('id', args.id).one());
    if (!dashboard) {
      throw new MutationACLError('Dashboard delete failed: dashboard not found', 'dashboards');
    }
    if (dashboard.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Dashboard delete failed: workspace mismatch', 'dashboards');
    }

    // Creator can always delete.
    if (dashboard.createdBy === this.ctx.userID) {
      return;
    }

    // Otherwise must be an OWNER participant.
    const isOwner = await tx.run(
      zql.dashboard_participants
        .where('dashboardId', args.id)
        .where('userId', this.ctx.userID)
        .where('role', DashboardRole.OWNER)
        .one(),
    );

    if (!isOwner) {
      throw new MutationACLError('Dashboard delete failed: only dashboard owners can delete the dashboard', 'dashboards');
    }
  }
}
