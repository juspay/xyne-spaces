import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ChannelParticipantsACL extends BaseQueryACL<'channel_participants'> {
  constructor(ctx: Context) {
    super(ctx, 'channel_participants');
  }

  canSelect<TReturn>(query: Query<'channel_participants', Schema, TReturn>): Query<'channel_participants', Schema, TReturn> {
    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('userId', this.ctx.userID),
        exists('channel', (ch) =>
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
