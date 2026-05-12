import type { Query } from '@rocicorp/zero';
import { type Schema, type Context, ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
export class ProjectsACL extends BaseQueryACL<'projects'> {
  constructor(ctx: Context) {
    super(ctx, 'projects');
  }

  canSelect<TReturn>(query: Query<'projects', Schema, TReturn>): Query<'projects', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
