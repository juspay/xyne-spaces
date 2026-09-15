import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class SurfaceNudgesACL extends BaseQueryACL<'surface_nudges'> {
  constructor(ctx: Context) {
    super(ctx, 'surface_nudges');
  }

  canSelect<TReturn>(query: Query<'surface_nudges', Schema, TReturn>): Query<'surface_nudges', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
