import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { DashboardRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

// Per-instance ACL for dashboard_queries_mapping (the dashboard <-> query link).
// A tile being added to / removed from a dashboard goes through this mapping,
// so it's the gate for "can this user change this dashboard's tiles". Mirrors
// the access check the old DashboardComponentsACL enforced before tiles were
// unified into the `queries` table.
//
// Edit access = dashboard creator OR participant with role OWNER/EDITOR.
// VIEWER participants are rejected.
export class DashboardQueriesMappingACL extends BaseACL<'dashboard_queries_mapping'> {
  private async requireEditAccess(dashboardId: string, tx: Transaction<Schema>): Promise<void> {
    const dashboard = await tx.run(zql.dashboards.where('id', dashboardId).one());
    if (!dashboard) {
      throw new MutationACLError('Dashboard tile access denied: parent dashboard does not exist', 'dashboard_queries_mapping');
    }
    if (dashboard.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Dashboard tile access denied: workspace mismatch', 'dashboard_queries_mapping');
    }
    if (dashboard.createdBy === this.ctx.userID) {
      return;
    }
    const participant = await tx.run(
      zql.dashboard_participants
        .where('dashboardId', dashboardId)
        .where('userId', this.ctx.userID)
        .one(),
    );
    if (!participant) {
      throw new MutationACLError('Dashboard tile access denied: not a participant on the dashboard', 'dashboard_queries_mapping');
    }
    if (participant.role === DashboardRole.VIEWER) {
      throw new MutationACLError('Dashboard tile access denied: viewer role cannot edit tiles', 'dashboard_queries_mapping');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'dashboard_queries_mapping'>>, tx: Transaction<Schema>): Promise<void> {
    await this.requireEditAccess(args.dashboardId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'dashboard_queries_mapping'>>, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(zql.dashboard_queries_mapping.where('id', args.id).one());
    if (!mapping) {
      throw new MutationACLError('Dashboard tile update failed: mapping not found', 'dashboard_queries_mapping');
    }
    await this.requireEditAccess(mapping.dashboardId, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'dashboard_queries_mapping'>>, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(zql.dashboard_queries_mapping.where('id', args.id).one());
    if (!mapping) {
      throw new MutationACLError('Dashboard tile delete failed: mapping not found', 'dashboard_queries_mapping');
    }
    await this.requireEditAccess(mapping.dashboardId, tx);
  }
}
