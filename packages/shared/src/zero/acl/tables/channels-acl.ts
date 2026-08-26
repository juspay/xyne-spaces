import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility, WorkspaceRole } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import {
  guestChannelAccessWhere,
  isGuestContext,
  channelVisibleWhere,
  connectChannelAccessWhere,
} from '../core/guest-acl-utils';
export class ChannelsACL extends BaseQueryACL<'channels'> {
  constructor(ctx: Context) {
    super(ctx, 'channels');
  }

  // NOTE: 'channels' is opted out of the define-query.ts workspace backstop (Slack-Connect),
  // so every branch below must be fully self-scoping — each keeps its own `workspaceId = ctx`
  // and only ADDS active-connect-membership as an OR alternative.
  canSelect<TReturn>(query: Query<'channels', Schema, TReturn>): Query<'channels', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.where(channelVisibleWhere(this.ctx, guestChannelAccessWhere(this.ctx)));
    }

    if (this.ctx.role === WorkspaceRole.ADMIN || this.ctx.role === WorkspaceRole.OWNER) {
      // All channels in my workspace, plus connect channels I'm an active member of.
      return query.where((h) =>
        h.or(h.cmp('workspaceId', '=', this.ctx.workspaceId), connectChannelAccessWhere(this.ctx)(h)),
      );
    }

    return query.where(
      channelVisibleWhere(this.ctx, ({ or, cmp, exists }: any) =>
        or(
          cmp('visibility', '=', ChannelVisibility.PUBLIC),
          exists('participants', (p: any) => p.where('userId', this.ctx.userID)),
        ),
      ),
    );
  }
}
