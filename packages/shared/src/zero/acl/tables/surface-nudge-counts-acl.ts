import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class SurfaceNudgeCountsACL extends BaseQueryACL<'surface_nudge_counts'> {
  constructor(ctx: Context) {
    super(ctx, 'surface_nudge_counts');
  }

  canSelect<TReturn>(query: Query<'surface_nudge_counts', Schema, TReturn>): Query<'surface_nudge_counts', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
