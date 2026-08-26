import type { Query } from '@rocicorp/zero';
import {type Schema, type Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestChannelAccessWhere, isGuestContext, channelVisibleWhere } from '../core/guest-acl-utils';

export class SubTicketsACL extends BaseQueryACL<'sub_tickets'> {
  constructor(ctx: Context) {
    super(ctx, 'sub_tickets');
  }

  // NOTE: 'sub_tickets' is opted out of the define-query.ts workspace backstop (Slack-Connect),
  // so every branch must be fully self-scoping (no reliance on a root workspaceId re-clamp).
  canSelect<TReturn>(query: Query<'sub_tickets', Schema, TReturn>): Query<'sub_tickets', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      // Each arm gates on a channel visible to me (same-workspace guest rule OR active connect
      // membership via channelVisibleWhere), so no root workspaceId clamp is needed.
      return query.where(({ or, exists }: any) =>
        or(
          exists('mappedTicket', (t: any) =>
            t.whereExists('channel', (ch: any) =>
              ch.where(channelVisibleWhere(this.ctx, guestChannelAccessWhere(this.ctx))),
            ),
          ),
          exists('conversation', (c: any) =>
            c.whereExists('channel', (ch: any) =>
              ch.where(channelVisibleWhere(this.ctx, guestChannelAccessWhere(this.ctx))),
            ),
          ),
        ),
      );
    }

    // A sub-ticket is visible when either it is not yet mapped to a parent ticket
    // (mappedTicketId is null — a valid state, scoped to the caller's workspace since an
    // unmapped sub-ticket has no channel to gate on) OR the caller can access the mapped
    // ticket's channel: same-workspace PUBLIC/participant rule OR active connect membership.
    return query.where(({ or, and, cmp, exists }: any) =>
      or(
        and(
          cmp('mappedTicketId', 'IS', null),
          cmp('workspaceId', '=', this.ctx.workspaceId),
        ),
        exists('mappedTicket', (t: any) =>
          t.whereExists('channel', (ch: any) =>
            ch.where(
              channelVisibleWhere(this.ctx, ({ or: o, cmp: c, exists: e }: any) =>
                o(
                  c('visibility', ChannelVisibility.PUBLIC),
                  e('participants', (p: any) => p.where('userId', this.ctx.userID)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
