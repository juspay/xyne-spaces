import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect } from '../core/guest-acl-utils';
import { canUseDashboards, readableDashboardWhere } from '../core/dashboard-access';

export class DashboardsACL extends BaseQueryACL<'dashboards'> {
  constructor(ctx: Context) {
    super(ctx, 'dashboards');
  }

  canSelect<TReturn>(query: Query<'dashboards', Schema, TReturn>): Query<'dashboards', Schema, TReturn> {
    // Visible only to the people it is shared with (see dashboard-access.ts). Saved filters can
    // name customers and people, so workspace scope alone is not enough.
    if (!canUseDashboards(this.ctx)) return denyGuestSelect(query, 'id');
    return query.where('workspaceId', '=', this.ctx.workspaceId).where(readableDashboardWhere(this.ctx));
  }
}
