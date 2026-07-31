import type { Query } from '@rocicorp/zero';
import {type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class WorkflowExecutionsACL extends BaseQueryACL<'workflow_executions'> {
  constructor(ctx: Context) {
    super(ctx, 'workflow_executions');
  }

  canSelect<TReturn>(query: Query<'workflow_executions', Schema, TReturn>): Query<'workflow_executions', Schema, TReturn> {
    return query.whereExists('createdByUser', (u) =>
      u.where('workspaceId', '=', this.ctx.workspaceId)
    // TODO: need to add check with WorkflowExecutionUsers table as its not public currenlty
    );
  }
}
