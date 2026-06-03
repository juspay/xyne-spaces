import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { DashboardRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

// Per-instance ACL for the unified `queries` table (holds both v1 QueryBuilder
// saved queries AND v2 dashboard tiles, queryType='external').
//
// Insert / Delete are intentionally permissive here: a query row only becomes
// dashboard-scoped via its dashboard_queries_mapping row, and that mapping's
// insert/delete is gated by DashboardQueriesMappingACL (which runs in the same
// mutator transaction). So adding/removing a tile is already access-checked at
// the mapping; the bare query row is harmless without a mapping.
//
// Update IS gated: editing a query that's attached to a dashboard requires
// editor-or-higher access on that dashboard. Standalone (unmapped) queries —
// e.g. legacy QueryBuilder drafts not yet on a dashboard — are left permissive
// (their authority is the query.upsert mutator, as before).
export class QueriesACL extends BaseACL<'queries'> {
  private async requireEditAccessIfMapped(queryId: string, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(
      zql.dashboard_queries_mapping.where('queryId', queryId).one(),
    );
    if (!mapping) {
      return; // unmapped / standalone query — no dashboard gate
    }
    const dashboard = await tx.run(zql.dashboards.where('id', mapping.dashboardId).one());
    if (!dashboard) {
      return; // orphan mapping — nothing to gate against
    }
    if (dashboard.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Query update denied: workspace mismatch', 'queries');
    }
    if (dashboard.createdBy === this.ctx.userID) {
      return;
    }
    const participant = await tx.run(
      zql.dashboard_participants
        .where('dashboardId', mapping.dashboardId)
        .where('userId', this.ctx.userID)
        .one(),
    );
    if (!participant || participant.role === DashboardRole.VIEWER) {
      throw new MutationACLError('Query update denied: editor access required on the dashboard', 'queries');
    }
  }

  async canInsert(_args: InsertValue<TableSchema<'queries'>>, _tx: Transaction<Schema>): Promise<void> {
    // Gated at the mapping insert; bare query row is harmless.
  }

  async canUpdate(args: UpdateValue<TableSchema<'queries'>>, tx: Transaction<Schema>): Promise<void> {
    await this.requireEditAccessIfMapped(args.id, tx);
  }

  async canDelete(_args: DeleteID<TableSchema<'queries'>>, _tx: Transaction<Schema>): Promise<void> {
    // Gated at the mapping delete (which runs first in the cascade).
  }
}
