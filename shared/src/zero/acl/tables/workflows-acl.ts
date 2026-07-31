import type { Query } from '@rocicorp/zero';
import {type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class WorkflowsACL extends BaseQueryACL<'workflows'> {
  constructor(ctx: Context) {
    super(ctx, 'workflows');
  }

  canSelect<TReturn>(query: Query<'workflows', Schema, TReturn>): Query<'workflows', Schema, TReturn> {
    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('ticketId', 'IS', null),
        exists('ticket', (t) => t.where('workspaceId', '=', this.ctx.workspaceId))
      )
    );
  }
}
