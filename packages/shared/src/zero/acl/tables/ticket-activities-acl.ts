import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestTicketAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class TicketActivitiesACL extends BaseQueryACL<'ticket_activities'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_activities');
  }

  canSelect<TReturn>(query: Query<'ticket_activities', Schema, TReturn>): Query<'ticket_activities', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('ticket', (t) =>
        t
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(guestTicketAccessWhere(this.ctx)),
      );
    }

    return query.whereExists('ticket', (t) =>
      t
        .where('workspaceId', '=', this.ctx.workspaceId)
        .whereExists('channel', (ch) =>
          ch.where(({ or, cmp, exists }) =>
            or(
              cmp('visibility', ChannelVisibility.PUBLIC),
              exists('participants', (p) => p.where('userId', this.ctx.userID))
            )
          )
        )
    );
  }
}
