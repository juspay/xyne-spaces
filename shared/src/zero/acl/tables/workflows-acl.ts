import type { Query } from '@rocicorp/zero';
import {type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestTicketAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class WorkflowsACL extends BaseQueryACL<'workflows'> {
  constructor(ctx: Context) {
    super(ctx, 'workflows');
  }

  canSelect<TReturn>(query: Query<'workflows', Schema, TReturn>): Query<'workflows', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('ticket', (t) =>
        t
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(guestTicketAccessWhere(this.ctx)),
      );
    }

    // DeskAutomations are owner-scoped personal rules managed via REST only —
    // never sync them to Zero clients (including other workspace agents).
    return query
      .where(({ or, cmp, and, exists }) =>
        and(
          or(
            cmp('workflowType', 'IS', null),
            cmp('workflowType', '!=', 'DeskAutomations'),
          ),
          or(
            cmp('ticketId', 'IS', null),
            exists('ticket', t => t.where('workspaceId', '=', this.ctx.workspaceId)),
          ),
        ),
      );
  }
}
