import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class TicketEntityMappingsACL extends BaseQueryACL<'ticket_entity_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_entity_mappings');
  }

  canSelect<TReturn>(query: Query<'ticket_entity_mappings', Schema, TReturn>): Query<'ticket_entity_mappings', Schema, TReturn> {
    return query.whereExists('ticket', (t) =>
      t.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
