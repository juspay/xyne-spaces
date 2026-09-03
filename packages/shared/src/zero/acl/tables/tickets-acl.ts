import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { guestTicketAccessWhere, isGuestContext } from '../core/guest-acl-utils';
import { reachableTicketsOnly } from '../core/ticket-access-utils';

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

    const channelId = args?.channelId as string | undefined;

    // When the caller knows the user is a member (pre-checked against channel_user_status),
    // use a scalar EXISTS on channel_participants which resolves once at hydration time
    // instead of the expensive OR(PUBLIC, EXISTS(participants)) evaluated per-row during push.

    query = query.where('workspaceId', '=', this.ctx.workspaceId);

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

    return reachableTicketsOnly(query, this.ctx);
  
  }
}
