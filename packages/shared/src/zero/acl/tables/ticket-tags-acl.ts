import type { Query } from '@rocicorp/zero';
import {type Schema, type Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestChannelAccessWhere, isGuestContext, channelVisibleWhere } from '../core/guest-acl-utils';

export class TicketTagsACL extends BaseQueryACL<'ticket_tags'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_tags');
  }

  // NOTE: 'ticket_tags' is opted out of the define-query.ts workspace backstop (Slack-Connect),
  // so every branch must be fully self-scoping via the ticket's channel gate.
  canSelect<TReturn>(query: Query<'ticket_tags', Schema, TReturn>): Query<'ticket_tags', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('ticket', (t: any) =>
        t.whereExists('channel', (ch: any) =>
          ch.where(channelVisibleWhere(this.ctx, guestChannelAccessWhere(this.ctx))),
        ),
      );
    }

    return query.whereExists('ticket', (t: any) =>
      t.whereExists('channel', (ch: any) =>
        ch.where(
          channelVisibleWhere(this.ctx, ({ or, cmp, exists }: any) =>
            or(
              cmp('visibility', ChannelVisibility.PUBLIC),
              exists('participants', (p: any) => p.where('userId', this.ctx.userID)),
            ),
          ),
        ),
      ),
    );
  }
}
