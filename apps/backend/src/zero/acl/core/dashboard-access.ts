import type { Transaction } from '@rocicorp/zero';
import { DashboardSharePrincipal, DashboardShareRole, type Schema } from '@xyne/shared';
import { zql } from '../../queries';
import type { QueryContext } from './types';

/*
 * Write checks for legacy analytics dashboards (the `dashboards` table). The read rule lives in
 * packages/shared/src/zero/acl/core/dashboard-access.ts. Owner = creator; editors = people with
 * an EDITOR share. Only the owner may delete a dashboard; sharing changes go through the REST API.
 */

type DashboardLike = { id: string; createdBy: string };

export async function canEditDashboard(
  ctx: QueryContext,
  dashboard: DashboardLike,
  tx: Transaction<Schema>,
): Promise<boolean> {
  if (dashboard.createdBy === ctx.userID) return true;
  const share = await tx.run(
    zql.dashboard_shares
      .where('dashboardId', dashboard.id)
      .where('principalType', DashboardSharePrincipal.USER)
      .where('principalId', ctx.userID)
      .where('role', DashboardShareRole.EDITOR)
      .one(),
  );
  return share !== undefined && share !== null;
}

/** Loads the dashboard and returns it when the caller may edit it, otherwise null. */
export async function editableDashboard(ctx: QueryContext, dashboardId: string, tx: Transaction<Schema>) {
  const dashboard = await tx.run(zql.dashboards.where('id', dashboardId).one());
  if (!dashboard || dashboard.workspaceId !== ctx.workspaceId) return null;
  return (await canEditDashboard(ctx, dashboard, tx)) ? dashboard : null;
}

/**
 * A saved query (widget) may be changed by its creator or by anyone who can edit a dashboard it
 * is on.
 */
export async function canEditQuery(
  ctx: QueryContext,
  query: { id: string; createdBy: string },
  tx: Transaction<Schema>,
): Promise<boolean> {
  if (query.createdBy === ctx.userID) return true;
  const mappings = await tx.run(zql.dashboard_queries_mapping.where('queryId', query.id));
  for (const mapping of mappings) {
    if (await editableDashboard(ctx, mapping.dashboardId, tx)) return true;
  }
  return false;
}
