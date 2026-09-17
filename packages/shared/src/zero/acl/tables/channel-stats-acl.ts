import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class ChannelStatsACL extends BaseQueryACL<'channel_stats'> {
  constructor(ctx: Context) {
    super(ctx, 'channel_stats');
  }

  canSelect<TReturn>(query: Query<'channel_stats', Schema, TReturn>, args?: SelectArgs): Query<'channel_stats', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('channel', (ch) =>
        ch
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(guestChannelAccessWhere(this.ctx)),
      );
    }

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query.whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR);
    }

    // Pin the join direction — see tickets-acl.ts for the full rationale. Left
    // free, prod flipped this exists into an unconstrained `SELECT … FROM
    // "channels" ORDER BY "id"` scan (the access OR cannot be pushed down).
    return query.whereExists('channel', (ch) =>
      ch.where(channelAccessWhere(this.ctx)),
      { flip: false },
    );
  }
}
