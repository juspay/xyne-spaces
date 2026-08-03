import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class RecurringCallSeriesACL extends BaseQueryACL<'recurring_call_series'> {
  constructor(ctx: Context) {
    super(ctx, 'recurring_call_series');
  }

  canSelect<TReturn>(query: Query<'recurring_call_series', Schema, TReturn>): Query<'recurring_call_series', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
