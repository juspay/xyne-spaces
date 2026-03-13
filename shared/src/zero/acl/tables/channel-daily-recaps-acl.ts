import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ChannelDailyRecapsACL extends BaseQueryACL<'channel_daily_recaps'> {
  constructor(ctx: Context) {
    super(ctx, 'channel_daily_recaps');
  }

  canSelect<TReturn>(query: Query<'channel_daily_recaps', Schema, TReturn>): Query<'channel_daily_recaps', Schema, TReturn> {
    // Users can view recaps for channels that are either public or they are participants in
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