import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestTicketAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class TicketsACL extends BaseQueryACL<'tickets'> {
  constructor(ctx: Context) {
    super(ctx, 'tickets');
  }

  canSelect<TReturn>(query: Query<'tickets', Schema, TReturn>, args?: SelectArgs): Query<'tickets', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(guestTicketAccessWhere(this.ctx));
    }

    query = query.where('workspaceId', '=', this.ctx.workspaceId);

    // Single-channel queries (args.channelId matches the query's own filter):
    // the access decision is row-invariant, so it resolves ONCE per hydration
    // (scalar) instead of per-row channel/participant probes. isMember only
    // picks the skinnier verified shape; access is always verified against
    // ctx.userID.
    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query.whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR);
    }

    return query.whereExists('channel', (ch) =>
      ch.where(channelAccessWhere(this.ctx))
    );
  }
}
