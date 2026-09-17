import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ProactiveNudgesACL extends BaseQueryACL<'proactive_nudges'> {
  constructor(ctx: Context) {
    super(ctx, 'proactive_nudges');
  }

  canSelect<TReturn>(query: Query<'proactive_nudges', Schema, TReturn>): Query<'proactive_nudges', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
