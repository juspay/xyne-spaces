import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestTicketAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class TicketSubTicketMappingsACL extends BaseQueryACL<'ticket_sub_ticket_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_sub_ticket_mappings');
  }

  canSelect<TReturn>(query: Query<'ticket_sub_ticket_mappings', Schema, TReturn>): Query<'ticket_sub_ticket_mappings', Schema, TReturn> {
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
