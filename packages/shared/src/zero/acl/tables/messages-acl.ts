import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import {
  guestChannelAccessWhere,
  isGuestContext,
  channelVisibleWhere,
} from '../core/guest-acl-utils';

export class MessagesACL extends BaseQueryACL<'messages'> {
  constructor(ctx: Context) {
    super(ctx, 'messages');
  }

  // NOTE: 'messages' is opted out of the define-query.ts workspace backstop (Slack-Connect).
  // The channel gate below is the sole tenant fence, so it keeps `workspaceId = ctx` and only
  // ADDS active-connect-membership (via channelVisibleWhere) as an OR alternative.
  canSelect<TReturn>(query: Query<'messages', Schema, TReturn>): Query<'messages', Schema, TReturn> {
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
            ch.where(channelVisibleWhere(this.ctx, guestChannelAccessWhere(this.ctx))),
          ),
        );
    }

    return query
      .where(({or, cmp}) => {
        return or(
          cmp("visibleTo", "IS" ,null),
          cmp("visibleTo", this.ctx.userID)
        )
      })
      .whereExists('conversation', (c) =>
        c.whereExists('channel', (ch) =>
          ch.where(
            channelVisibleWhere(this.ctx, ({ or, cmp, exists }: any) =>
              or(
                cmp('visibility', '=', ChannelVisibility.PUBLIC),
                exists('participants', (p: any) => p.where('userId', this.ctx.userID)),
              ),
            ),
          ),
        )
      );
  }
}
