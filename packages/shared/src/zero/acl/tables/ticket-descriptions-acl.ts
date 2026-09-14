import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';
import type { SelectArgs } from '../core/types';

export class TicketDescriptionsACL extends BaseQueryACL<'ticket_descriptions'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_descriptions');
  }

  canSelect<TReturn>(
    query: Query<'ticket_descriptions', Schema, TReturn>,
    args?: SelectArgs
  ): Query<'ticket_descriptions', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      // Guest access: check channel-level permissions directly via channelId
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .whereExists('channel', (c) => c.where(guestChannelAccessWhere(this.ctx)));
    }

    query = query.where('workspaceId', '=', this.ctx.workspaceId);

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      // Scalar optimization when channelId is known
      return query.whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR);
    }

    // Regular users: check channel access permissions
    return query.whereExists('channel', (ch) => ch.where(channelAccessWhere(this.ctx)));
  }
}
