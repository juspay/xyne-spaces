import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class TicketReferenceMappingsACL extends BaseQueryACL<'ticket_reference_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_reference_mappings');
  }

  canSelect<TReturn>(
    query: Query<'ticket_reference_mappings', Schema, TReturn>,
  ): Query<'ticket_reference_mappings', Schema, TReturn> {
    return query.whereExists('sourceTicket', (t) =>
      t.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
