import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class SurfaceLinksACL extends BaseQueryACL<'surface_links'> {
  constructor(ctx: Context) {
    super(ctx, 'surface_links');
  }

  canSelect<TReturn>(query: Query<'surface_links', Schema, TReturn>): Query<'surface_links', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
