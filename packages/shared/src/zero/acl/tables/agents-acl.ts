import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class AgentsACL extends BaseQueryACL<'agents'> {
  constructor(ctx: Context) {
    super(ctx, 'agents');
  }

  canSelect<TReturn>(query: Query<'agents', Schema, TReturn>): Query<'agents', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
