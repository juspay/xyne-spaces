import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestProjectAccessWhere, isGuestContext } from '../core/guest-acl-utils';
export class ProjectsACL extends BaseQueryACL<'projects'> {
  constructor(ctx: Context) {
    super(ctx, 'projects');
  }

  canSelect<TReturn>(query: Query<'projects', Schema, TReturn>): Query<'projects', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(guestProjectAccessWhere(this.ctx));
    }

    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
