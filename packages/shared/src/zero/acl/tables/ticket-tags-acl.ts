import type { Query } from '@rocicorp/zero';
import {type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestTicketAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class TicketTagsACL extends BaseQueryACL<'ticket_tags'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_tags');
  }

  canSelect<TReturn>(query: Query<'ticket_tags', Schema, TReturn>, args?: SelectArgs): Query<'ticket_tags', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('ticket', (t) =>
        t
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(guestTicketAccessWhere(this.ctx)),
      );
    }

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query.whereExists('ticket', (t) =>
        t
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where('channelId', channelId)
          .whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR)
      );
    }

    return query.whereExists('ticket', (t) =>
      t
        .where('workspaceId', '=', this.ctx.workspaceId)
        .whereExists('channel', (ch) =>
          ch.where(channelAccessWhere(this.ctx))
        )
    );
  }
}
