import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ChannelStatsACL extends BaseQueryACL<'channel_stats'> {
  constructor(ctx: Context) {
    super(ctx, 'channel_stats');
  }

  canSelect<TReturn>(query: Query<'channel_stats', Schema, TReturn>): Query<'channel_stats', Schema, TReturn> {
    return query.whereExists('channel', (ch) =>
      ch.where(({ or, cmp, exists }) =>
        or(
          cmp('visibility', '=', ChannelVisibility.PUBLIC),
          exists('participants', (p) => p.where('userId', this.ctx.userID))
        )
      )
    );
  }
}
