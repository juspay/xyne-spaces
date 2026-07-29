import type { Query } from '@rocicorp/zero';
import {type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestTicketAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class TicketTagsACL extends BaseQueryACL<'ticket_tags'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_tags');
  }

  canSelect<TReturn>(query: Query<'ticket_tags', Schema, TReturn>): Query<'ticket_tags', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('ticket', (t) =>
        t
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(guestTicketAccessWhere(this.ctx)),
      );
    }

    return query.whereExists('ticket', (t) =>
      t.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
