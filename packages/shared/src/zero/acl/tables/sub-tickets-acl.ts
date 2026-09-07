import type { Query } from '@rocicorp/zero';
import {type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, guestTicketAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class SubTicketsACL extends BaseQueryACL<'sub_tickets'> {
  constructor(ctx: Context) {
    super(ctx, 'sub_tickets');
  }

  canSelect<TReturn>(query: Query<'sub_tickets', Schema, TReturn>, args?: SelectArgs): Query<'sub_tickets', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(({ or, exists }) =>
          or(
            exists('mappedTicket', (t) => t.where(guestTicketAccessWhere(this.ctx))),
            exists('conversation', (c) =>
              c.whereExists('channel', (ch) =>
                ch.where(guestChannelAccessWhere(this.ctx)),
              ),
            ),
          ),
        );
    }

    // A sub-ticket is visible when it is in the caller's workspace AND either it is not yet
    // mapped to a parent ticket (mappedTicketId is null — a valid state) OR the caller can
    // access the mapped ticket's channel (PUBLIC, or a participant). Without the null branch,
    // unmapped sub-tickets would be hidden from everyone.
    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(({ or, cmp, exists }) =>
          or(
            cmp('mappedTicketId', 'IS', null),
            exists('mappedTicket', (t) =>
              t
                .where('channelId', channelId)
                .whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR)
            )
          )
        );
    }

    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where(({ or, cmp, exists }) =>
        or(
          cmp('mappedTicketId', 'IS', null),
          exists('mappedTicket', (t) =>
            t.whereExists('channel', (ch) =>
              ch.where(channelAccessWhere(this.ctx))
            )
          )
        )
      );
  }
}
