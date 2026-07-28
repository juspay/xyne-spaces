import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestProjectAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class BoardsACL extends BaseQueryACL<'boards'> {
  constructor(ctx: Context) {
    super(ctx, 'boards');
  }

  canSelect<TReturn>(query: Query<'boards', Schema, TReturn>): Query<'boards', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .whereExists('project', (p) => p.where(guestProjectAccessWhere(this.ctx)));
    }

    // Direct workspaceId check - no need to traverse through project
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
