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

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query.whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR);
    }

    // Pin the join direction instead of letting the planner choose it.
    //
    // Left free, the planner may flip this exists so the CHILD drives: it then
    // materialises `channels` with an unconstrained read (`SELECT … FROM "channels"
    // ORDER BY "id"` — every channel on the cluster) and turns the result into a
    // literal `tickets.channelId IN (…)` list. That is the plan production picked,
    // and it cost 60,000 channel reads per hydration to yield 239 usable ids.
    //
    // As a semi-join the parent drives and each candidate ticket probes `channels`
    // by primary key, which the `take` operator bounds. Measured on the bench
    // replica: semi-join 62,697 rows scanned vs flipped 73,067, and the flipped
    // plan carried the whole channels table on top.
    return query.whereExists(
      'channel',
      (ch) => ch.where(channelAccessWhere(this.ctx)),
      { flip: false },
    );
  }
}
