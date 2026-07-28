import type { Query } from '@rocicorp/zero';
import {type Schema, type Context } from '../../schema';
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

    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
