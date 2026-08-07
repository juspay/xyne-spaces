import type { Query } from '@rocicorp/zero';
import {type Schema, type Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestChannelAccessWhere, guestTicketAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class SubTicketsACL extends BaseQueryACL<'sub_tickets'> {
  constructor(ctx: Context) {
    super(ctx, 'sub_tickets');
  }

  canSelect<TReturn>(query: Query<'sub_tickets', Schema, TReturn>): Query<'sub_tickets', Schema, TReturn> {
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
    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where(({ or, cmp, exists }) =>
        or(
          cmp('mappedTicketId', 'IS', null),
          exists('mappedTicket', (t) =>
            t.whereExists('channel', (ch) =>
              ch.where(({ or: o, cmp: c, exists: e }) =>
                o(
                  c('visibility', ChannelVisibility.PUBLIC),
                  e('participants', (p) => p.where('userId', this.ctx.userID))
                )
              )
            )
          )
        )
      );
  }
}
