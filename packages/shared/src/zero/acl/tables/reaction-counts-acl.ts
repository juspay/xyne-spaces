import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import {
  guestChannelAccessWhere,
  isGuestContext,
  channelVisibleWhere,
} from '../core/guest-acl-utils';

export class ReactionCountsACL extends BaseQueryACL<'reaction_counts'> {
  constructor(ctx: Context) {
    super(ctx, 'reaction_counts');
  }

  canSelect<TReturn>(query: Query<'reaction_counts', Schema, TReturn>): Query<'reaction_counts', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('message', (m) =>
        m.whereExists('conversation', (c) =>
          c.whereExists('channel', (ch) =>
            ch.where(channelVisibleWhere(this.ctx, guestChannelAccessWhere(this.ctx))),
          )
        )
      );
    }

    return query.whereExists('message', (m) =>
      m.whereExists('conversation', (c) =>
        c.whereExists('channel', (ch) =>
          ch.where(
            channelVisibleWhere(this.ctx, ({ or, cmp, exists }: any) =>
              or(
                cmp('visibility', '=', ChannelVisibility.PUBLIC),
                exists('participants', (p: any) => p.where('userId', this.ctx.userID)),
              ),
            ),
          )
        )
      )
    );
  }
}
