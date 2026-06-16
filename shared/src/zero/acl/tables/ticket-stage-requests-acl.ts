import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class TicketStageRequestsACL extends BaseQueryACL<'ticket_stage_requests'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_stage_requests');
  }

  canSelect<TReturn>(
    query: Query<'ticket_stage_requests', Schema, TReturn>
  ): Query<'ticket_stage_requests', Schema, TReturn> {
    return query.whereExists('ticket', (t) =>
      t.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
