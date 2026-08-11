import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class TicketExportsACL extends BaseQueryACL<'ticket_exports'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_exports');
  }

  canSelect<TReturn>(
    query: Query<'ticket_exports', Schema, TReturn>,
  ): Query<'ticket_exports', Schema, TReturn> {
    return query
      .where('workspaceId', this.ctx.workspaceId)
      .where('requestedBy', this.ctx.userID);
  }
}
