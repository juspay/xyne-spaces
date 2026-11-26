import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { DashboardSharePrincipal } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect } from '../core/guest-acl-utils';
import { canUseDashboards, editableDashboardWhere } from '../core/dashboard-access';

export class DashboardSharesACL extends BaseQueryACL<'dashboard_shares'> {
  constructor(ctx: Context) {
    super(ctx, 'dashboard_shares');
  }

  canSelect<TReturn>(query: Query<'dashboard_shares', Schema, TReturn>): Query<'dashboard_shares', Schema, TReturn> {
    // The share list is for the dashboard's owner and editors. Anyone else sees only the row
    // naming them, never who else has the dashboard.
    if (!canUseDashboards(this.ctx)) return denyGuestSelect(query, 'id');
    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where(({ or, and, cmp, exists }) =>
        or(
          and(cmp('principalType', '=', DashboardSharePrincipal.USER), cmp('principalId', '=', this.ctx.userID)),
          exists('dashboard', d => d.where(editableDashboardWhere(this.ctx))),
        ),
      );
  }
}
