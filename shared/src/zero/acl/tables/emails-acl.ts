import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';

export class EmailsACL extends BaseQueryACL<'emails'> {
  constructor(ctx: Context) {
    super(ctx, 'emails');
  }

  canSelect<TReturn>(query: Query<'emails', Schema, TReturn>, args?: SelectArgs): Query<'emails', Schema, TReturn> {
    const channelId = args?.channelId as string | undefined;

    // When the caller knows the user is a member (pre-checked against channel_user_status),
    // use a scalar EXISTS on channel_participants which resolves once at hydration time
    // instead of the expensive OR(PUBLIC, EXISTS(participants)) evaluated per-row during push.
    if (args?.isMember && channelId) {
      return query.whereExists('channel', (ch) =>
        ch.whereExists('participants', (p) =>
          p.where('userId', this.ctx.userID).where('channelId', channelId),
          { scalar: true }
        ),
      );
    }

    if (args?.isMember === false && channelId) {
      return query.whereExists('channel', (ch) =>
        ch.where("id", channelId).where('visibility', ChannelVisibility.PUBLIC),
        { scalar: true }
      );
    }

    return query.whereExists('channel', (ch) =>
      ch.where(({ or, cmp, exists }) =>
        or(
          cmp('visibility', ChannelVisibility.PUBLIC),
          exists('participants', (p) => p.where('userId', this.ctx.userID))
        )
      )
    );
  }
}
