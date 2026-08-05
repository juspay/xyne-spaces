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

    // Scope to the workspace via the row's own workspaceId. The old createdByUser hop
    // dropped system/automation executions (null createdBy) — those have no
    // createdByUser to traverse.
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
