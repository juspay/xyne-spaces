import { TicketReferenceRelation } from '../../types';
import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestTicketAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class TicketReferenceMappingsACL extends BaseQueryACL<'ticket_reference_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_reference_mappings');
  }

  canSelect<TReturn>(
    query: Query<'ticket_reference_mappings', Schema, TReturn>,
  ): Query<'ticket_reference_mappings', Schema, TReturn> {
    // Raw rows include the other ticket's id, even when a related ticket is ACL-filtered.
    // Typed dependencies use the authorized redaction transport instead. Legacy types are unchanged.
    query = query.where('relationType', '!=', TicketReferenceRelation.BLOCKS);
    if (isGuestContext(this.ctx)) {
      return query.whereExists('sourceTicket', (t) =>
        t
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(guestTicketAccessWhere(this.ctx)),
      );
    }

    return query.whereExists('sourceTicket', (t) =>
      t.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
