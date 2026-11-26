import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { canEditQuery, editableDashboard } from '../core/dashboard-access';
import { zql } from '../../queries';

const TABLE = 'dashboard_queries_mapping';

/**
 * A mapping places a saved query on a dashboard. The dashboard's owner and editors may add, move
 * or reorder its widgets, and may only place queries they can change themselves.
 */
export class DashboardQueriesMappingACL extends BaseACL<typeof TABLE> {
  private async canEditDashboardId(dashboardId: string, tx: Transaction<Schema>): Promise<boolean> {
    return (await editableDashboard(this.ctx, dashboardId, tx)) !== null;
  }

  private async canPlaceQuery(queryId: string, tx: Transaction<Schema>): Promise<boolean> {
    const query = await tx.run(zql.queries.where('id', queryId).one());
    if (!query) return false;
    assertWorkspaceMatch(this.ctx, query.workspaceId, TABLE);
    return canEditQuery(this.ctx, query, tx);
  }

  async canInsert(args: InsertValue<TableSchema<typeof TABLE>>, tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, TABLE);
    if (!(await this.canEditDashboardId(args.dashboardId as string, tx))) {
      throw new MutationACLError('You do not have permission to edit this dashboard', TABLE);
    }
    if (!(await this.canPlaceQuery(args.queryId as string, tx))) {
      throw new MutationACLError('Cannot add a saved query you cannot change', TABLE);
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<typeof TABLE>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.dashboard_queries_mapping.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Dashboard queries mapping update failed: mapping does not exist', TABLE);
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, TABLE);
    if (!(await this.canEditDashboardId(row.dashboardId, tx))) {
      throw new MutationACLError('You do not have permission to edit this dashboard', TABLE);
    }
    // Moving the mapping elsewhere needs the same rights as inserting it there.
    if (args.dashboardId !== undefined && args.dashboardId !== row.dashboardId) {
      if (!(await this.canEditDashboardId(args.dashboardId as string, tx))) {
        throw new MutationACLError('You do not have permission to edit this dashboard', TABLE);
      }
    }
    if (args.queryId !== undefined && args.queryId !== row.queryId) {
      if (!(await this.canPlaceQuery(args.queryId as string, tx))) {
        throw new MutationACLError('Cannot add a saved query you cannot change', TABLE);
      }
    }
  }

  async canDelete(args: DeleteID<TableSchema<typeof TABLE>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.dashboard_queries_mapping.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Dashboard queries mapping delete failed: mapping does not exist', TABLE);
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, TABLE);
    // Owners and editors may remove any widget; a query's creator may take their own query off a
    // dashboard (older data allowed placing queries on other people's dashboards).
    if (await this.canEditDashboardId(row.dashboardId, tx)) return;
    const query = await tx.run(zql.queries.where('id', row.queryId).one());
    if (query && query.createdBy === this.ctx.userID) return;
    throw new MutationACLError('You do not have permission to edit this dashboard', TABLE);
  }

  async canUpsert(_args: UpsertValue<TableSchema<typeof TABLE>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Dashboard queries mapping upsert failed: use insert or update separately', TABLE);
  }
}
