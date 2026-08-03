import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class QueriesACL extends BaseQueryACL<'queries'> {
  constructor(ctx: Context) {
    super(ctx, 'queries');
  }

  canSelect<TReturn>(query: Query<'queries', Schema, TReturn>): Query<'queries', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
