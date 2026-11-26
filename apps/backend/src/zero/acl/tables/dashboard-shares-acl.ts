import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

const TABLE = 'dashboard_shares';

/**
 * Shares are created and changed only through the REST API (/api/analytics-dashboards/:id/shares),
 * which checks channels and the ANALYTICS admin rule for workspace shares. Through Zero the only
 * write allowed is the dashboard owner removing shares while deleting the dashboard.
 */
export class DashboardSharesACL extends BaseACL<typeof TABLE> {
  async canInsert(_args: InsertValue<TableSchema<typeof TABLE>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Share a dashboard through the dashboards API', TABLE);
  }

  async canUpdate(_args: UpdateValue<TableSchema<typeof TABLE>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Share a dashboard through the dashboards API', TABLE);
  }

  async canUpsert(_args: UpsertValue<TableSchema<typeof TABLE>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Share a dashboard through the dashboards API', TABLE);
  }

  async canDelete(args: DeleteID<TableSchema<typeof TABLE>>, tx: Transaction<Schema>): Promise<void> {
    const share = await tx.run(zql.dashboard_shares.where('id', args.id).one());
    if (!share) {
      throw new MutationACLError('Dashboard share delete failed: share does not exist', TABLE);
    }
    assertWorkspaceMatch(this.ctx, share.workspaceId, TABLE);
    const dashboard = await tx.run(zql.dashboards.where('id', share.dashboardId).one());
    if (dashboard && dashboard.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Only the dashboard owner can remove shares here', TABLE);
    }
  }
}
