import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class TicketStageEtaACL extends BaseQueryACL<'ticket_stage_eta'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_stage_eta');
  }

  canSelect<TReturn>(
    query: Query<'ticket_stage_eta', Schema, TReturn>
  ): Query<'ticket_stage_eta', Schema, TReturn> {
    return query.whereExists('ticket', (t) =>
      t.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
