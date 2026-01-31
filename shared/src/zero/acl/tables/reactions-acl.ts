import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ReactionsACL extends BaseQueryACL<'reactions'> {
  constructor(ctx: Context) {
    super(ctx, 'reactions');
  }

  canSelect<TReturn>(query: Query<'reactions', Schema, TReturn>): Query<'reactions', Schema, TReturn> {
    return query.whereExists('message', (m) =>
      m.whereExists('conversation', (c) =>
        c.whereExists('channel', (ch) =>
          ch.where(({ or, cmp, exists }) =>
            or(
              cmp('visibility', '=', ChannelVisibility.PUBLIC),
              exists('participants', (p) => p.where('userId', this.ctx.userID))
            )
          )
        )
      )
    );
  }
}
