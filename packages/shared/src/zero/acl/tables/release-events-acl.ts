import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ReleaseEventsACL extends BaseQueryACL<'release_events'> {
  constructor(ctx: Context) {
    super(ctx, 'release_events');
  }

  canSelect<TReturn>(query: Query<'release_events', Schema, TReturn>): Query<'release_events', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
