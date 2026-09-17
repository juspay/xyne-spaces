import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class DashboardsACL extends BaseQueryACL<'dashboards'> {
  constructor(ctx: Context) {
    super(ctx, 'dashboards');
  }

  canSelect<TReturn>(query: Query<'dashboards', Schema, TReturn>): Query<'dashboards', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
