import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
export class ChannelsACL extends BaseQueryACL<'channels'> {
  constructor(ctx: Context) {
    super(ctx, 'channels');
  }

  canSelect<TReturn>(query: Query<'channels', Schema, TReturn>): Query<'channels', Schema, TReturn> {
    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('visibility', '=', ChannelVisibility.PUBLIC),
        exists('participants', (p) => p.where('userId', this.ctx.userID))
      )
    );
  }
}
