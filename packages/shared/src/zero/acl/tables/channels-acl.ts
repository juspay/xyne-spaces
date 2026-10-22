import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelScopeType, WorkspaceRole } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { channelAccessWhere } from '../core/channel-access';
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
      return query.where('workspaceId', '=', this.ctx.workspaceId).where(({ and, or, cmp, exists }) =>
        or(
          and(
            cmp('scopeType', '!=', ChannelScopeType.DM),
            cmp('scopeType', '!=', ChannelScopeType.GROUP_DM),
          ),
          exists('participants', p => p.where('userId', this.ctx.userID)),
        ),
      );
    }

    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where(channelAccessWhere(this.ctx));
  }
}
