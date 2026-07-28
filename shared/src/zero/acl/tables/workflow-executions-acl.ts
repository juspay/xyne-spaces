import type { Query } from '@rocicorp/zero';
import {type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class WorkflowExecutionsACL extends BaseQueryACL<'workflow_executions'> {
  constructor(ctx: Context) {
    super(ctx, 'workflow_executions');
  }

  canSelect<TReturn>(query: Query<'workflow_executions', Schema, TReturn>): Query<'workflow_executions', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    return query.whereExists('createdByUser', (u) =>
      u.where('workspaceId', '=', this.ctx.workspaceId)
    // TODO: need to add check with WorkflowExecutionUsers table as its not public currenlty
    );
  }
}
