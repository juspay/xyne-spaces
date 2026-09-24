import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class AuditLogChangesACL extends BaseQueryACL<'audit_log_changes'> {
  constructor(ctx: Context) {
    super(ctx, 'audit_log_changes');
  }

  canSelect<TReturn>(
    query: Query<'audit_log_changes', Schema, TReturn>,
  ): Query<'audit_log_changes', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
