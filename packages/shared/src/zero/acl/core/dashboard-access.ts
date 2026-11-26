import type { ExpressionFactory } from '@rocicorp/zero';
import { DashboardSharePrincipal, DashboardShareRole, WorkspaceRole } from '../../schema';
import type { Context, Schema } from '../../schema';

/*
 * Who can see a legacy analytics dashboard (the `dashboards` table):
 *   - its creator (owner);
 *   - a person it is shared with (USER share, EDITOR or VIEWER);
 *   - a current member of a channel it is shared with (CHANNEL share);
 *   - everyone in the workspace when it has a WORKSPACE share.
 * Editors are the creator and people with an EDITOR USER share. The backend mirrors this in
 * apps/backend/src/database/acl/tables/analytics-dashboard-access.ts and the Zero mutation ACLs.
 */

/** Guests and community members do not hold the ANALYTICS permission, so they see no dashboards. */
export function canUseDashboards(ctx: Context): boolean {
  return ctx.role !== WorkspaceRole.GUEST && ctx.role !== WorkspaceRole.COMMUNITY_MEMBER;
}

/** Shares that reach the user: theirs, a channel they are in, or the whole workspace. */
function sharesReachingUser(ctx: Context): ExpressionFactory<'dashboard_shares', Schema> {
  return ({ or, and, cmp, exists }) =>
    or(
      cmp('principalType', '=', DashboardSharePrincipal.WORKSPACE),
      and(cmp('principalType', '=', DashboardSharePrincipal.USER), cmp('principalId', '=', ctx.userID)),
      and(
        cmp('principalType', '=', DashboardSharePrincipal.CHANNEL),
        exists('channel', c => c.whereExists('participants', p => p.where('userId', '=', ctx.userID))),
      ),
    );
}

export function readableDashboardWhere(ctx: Context): ExpressionFactory<'dashboards', Schema> {
  return ({ or, cmp, exists }) =>
    or(cmp('createdBy', '=', ctx.userID), exists('shares', s => s.where(sharesReachingUser(ctx))));
}

export function editableDashboardWhere(ctx: Context): ExpressionFactory<'dashboards', Schema> {
  return ({ or, cmp, exists }) =>
    or(
      cmp('createdBy', '=', ctx.userID),
      exists('shares', s =>
        s
          .where('principalType', '=', DashboardSharePrincipal.USER)
          .where('principalId', '=', ctx.userID)
          .where('role', '=', DashboardShareRole.EDITOR),
      ),
    );
}
