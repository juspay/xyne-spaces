import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class AuditLogsACL extends BaseQueryACL<'audit_logs'> {
  constructor(ctx: Context) {
    super(ctx, 'audit_logs');
  }

  canSelect<TReturn>(
    query: Query<'audit_logs', Schema, TReturn>,
  ): Query<'audit_logs', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
