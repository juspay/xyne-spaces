import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class DelayedMessagesACL extends BaseQueryACL<'delayed_messages'> {
  constructor(ctx: Context) {
    super(ctx, 'delayed_messages');
  }

  canSelect<TReturn>(
    query: Query<'delayed_messages', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'delayed_messages', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('senderId', this.ctx.userID)
        .whereExists('channel', (ch) =>
          ch
            .where('workspaceId', '=', this.ctx.workspaceId)
            .where(guestChannelAccessWhere(this.ctx)),
        );
    }

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query
        .where('senderId', this.ctx.userID)
        .whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR);
    }

    return query
      .where('senderId', this.ctx.userID)
      .whereExists('channel', (ch) =>
        ch
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(channelAccessWhere(this.ctx)),
      );
  }
}
