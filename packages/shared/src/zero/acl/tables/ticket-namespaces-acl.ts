import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestProjectAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class TicketNamespacesACL extends BaseQueryACL<'ticket_namespaces'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_namespaces');
  }

  canSelect<TReturn>(
    query: Query<'ticket_namespaces', Schema, TReturn>,
  ): Query<'ticket_namespaces', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .whereExists('project', (p) => p.where(guestProjectAccessWhere(this.ctx)));
    }

    // Direct workspaceId check - no need to traverse through project
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
