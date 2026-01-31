import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class MessagesACL extends BaseQueryACL<'messages'> {
  constructor(ctx: Context) {
    super(ctx, 'messages');
  }

  canSelect<TReturn>(query: Query<'messages', Schema, TReturn>): Query<'messages', Schema, TReturn> {
    return query
      .where(({or, cmp}) => {
        return or(
          cmp("visibleTo", "IS" ,null),
          cmp("visibleTo", this.ctx.userID)
        )
      })
      .whereExists('conversation', (c) =>
        c.whereExists('channel', (ch) =>
          ch.where(({ or, cmp, exists }) =>
            or(
              cmp('visibility', '=', ChannelVisibility.PUBLIC),
              exists('participants', (p) => p.where('userId', this.ctx.userID))
            )
          )
        )
      );
  }
}
