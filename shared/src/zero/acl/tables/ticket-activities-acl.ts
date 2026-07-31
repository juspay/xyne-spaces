import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class TicketActivitiesACL extends BaseQueryACL<'ticket_activities'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_activities');
  }

  canSelect<TReturn>(query: Query<'ticket_activities', Schema, TReturn>): Query<'ticket_activities', Schema, TReturn> {
    return query.whereExists('ticket', (t) =>
      t.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
