import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class DelayedMessagesACL extends BaseQueryACL<'delayed_messages'> {
  constructor(ctx: Context) {
    super(ctx, 'delayed_messages');
  }

  canSelect<TReturn>(
    query: Query<'delayed_messages', Schema, TReturn>,
  ): Query<'delayed_messages', Schema, TReturn> {
    return query
      .where('senderId', this.ctx.userID)
      .whereExists('channel', (ch) =>
        ch
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(({ or, cmp, exists }) =>
            or(
              cmp('visibility', '=', ChannelVisibility.PUBLIC),
              exists('participants', (p) => p.where('userId', this.ctx.userID)),
            ),
          ),
      );
  }
}
