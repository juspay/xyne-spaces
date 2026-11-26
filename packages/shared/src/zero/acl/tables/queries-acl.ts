import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect } from '../core/guest-acl-utils';
import { canUseDashboards, readableDashboardWhere } from '../core/dashboard-access';

export class QueriesACL extends BaseQueryACL<'queries'> {
  constructor(ctx: Context) {
    super(ctx, 'queries');
  }

  canSelect<TReturn>(query: Query<'queries', Schema, TReturn>): Query<'queries', Schema, TReturn> {
    // A saved query (widget) is visible to its creator and to anyone who can see a dashboard it
    // is on. Its filters can name customers and people.
    if (!canUseDashboards(this.ctx)) return denyGuestSelect(query, 'id');
    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where(({ or, cmp, exists }) =>
        or(
          cmp('createdBy', '=', this.ctx.userID),
          exists('dashboardMappings', m => m.whereExists('dashboard', d => d.where(readableDashboardWhere(this.ctx)))),
        ),
      );
  }
}
