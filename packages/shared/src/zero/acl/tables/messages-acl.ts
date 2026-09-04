import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class MessagesACL extends BaseQueryACL<'messages'> {
  constructor(ctx: Context) {
    super(ctx, 'messages');
  }

  canSelect<TReturn>(query: Query<'messages', Schema, TReturn>, args?: SelectArgs): Query<'messages', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where(({ or, cmp }) =>
          or(
            cmp('visibleTo', 'IS', null),
            cmp('visibleTo', this.ctx.userID),
          ),
        )
        .whereExists('conversation', (c) =>
          c.whereExists('channel', (ch) =>
            ch
              .where('workspaceId', '=', this.ctx.workspaceId)
              .where(guestChannelAccessWhere(this.ctx)),
          ),
        );
    }

    const withVisibleTo = query.where(({ or, cmp }) => {
      return or(
        cmp('visibleTo', 'IS', null),
        cmp('visibleTo', this.ctx.userID)
      );
    });

    const { channelId, isMember } = channelAccessArgs(args);
    const conversationId = args?.conversationId as string | undefined;

    if (channelId) {
      return withVisibleTo.whereExists('conversation', (c) =>
        c
          .where('channelId', channelId)
          .whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR)
      );
    }

    if (conversationId) {
      return withVisibleTo.whereExists('conversation', (c) =>
        c
          .where('conversationId', conversationId)
          .whereExists('channel', (ch) =>
            ch
              .where('workspaceId', '=', this.ctx.workspaceId)
              .where(channelAccessWhere(this.ctx))
          ),
        SCALAR
      );
    }

    return withVisibleTo.whereExists('conversation', (c) =>
      c.whereExists('channel', (ch) =>
        ch
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(channelAccessWhere(this.ctx))
      )
    );
  }
}
