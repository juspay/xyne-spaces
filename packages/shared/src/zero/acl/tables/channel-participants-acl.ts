import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class ChannelParticipantsACL extends BaseQueryACL<'channel_participants'> {
  constructor(ctx: Context) {
    super(ctx, 'channel_participants');
  }

  canSelect<TReturn>(query: Query<'channel_participants', Schema, TReturn>, args?: SelectArgs): Query<'channel_participants', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('channel', (ch) =>
        ch
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(guestChannelAccessWhere(this.ctx)),
      );
    }

    // Single-channel queries (args.channelId matches the query's own filter):
    // the channel-access half of the OR is row-invariant, so it resolves ONCE
    // per hydration (scalar); the caller's-own-row half stays a cheap column
    // compare per row.
    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query.where(({ or, cmp, exists }) =>
        or(
          cmp('userId', this.ctx.userID),
          exists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR),
        ),
      );
    }

    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('userId', this.ctx.userID),
        exists('channel', (ch) =>
          ch
            .where('workspaceId', '=', this.ctx.workspaceId)
            .where(channelAccessWhere(this.ctx))
        )
      )
    );
  }
}
