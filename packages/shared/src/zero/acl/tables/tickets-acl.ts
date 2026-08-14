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

    return query.whereExists('channel', (ch) =>
      ch.where(channelAccessWhere(this.ctx))
    );
  }
}
