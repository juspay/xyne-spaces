import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility, WorkspaceRole } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';
export class ChannelsACL extends BaseQueryACL<'channels'> {
  constructor(ctx: Context) {
    super(ctx, 'channels');
  }

  canSelect<TReturn>(query: Query<'channels', Schema, TReturn>): Query<'channels', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(guestChannelAccessWhere(this.ctx));
    }

    if (this.ctx.role === WorkspaceRole.ADMIN || this.ctx.role === WorkspaceRole.OWNER) {
      return query.where('workspaceId', '=', this.ctx.workspaceId);
    }

    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where(({ or, cmp, exists }) =>
        or(
          cmp('visibility', '=', ChannelVisibility.PUBLIC),
          exists('participants', (p) => p.where('userId', this.ctx.userID))
        )
      );
  }
}
