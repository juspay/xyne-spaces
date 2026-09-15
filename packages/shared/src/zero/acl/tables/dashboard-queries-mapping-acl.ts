import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class DashboardQueriesMappingACL extends BaseQueryACL<'dashboard_queries_mapping'> {
  constructor(ctx: Context) {
    super(ctx, 'dashboard_queries_mapping');
  }

  canSelect<TReturn>(query: Query<'dashboard_queries_mapping', Schema, TReturn>): Query<'dashboard_queries_mapping', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
