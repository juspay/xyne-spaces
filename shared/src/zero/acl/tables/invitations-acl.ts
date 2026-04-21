import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { WorkspaceRole } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class InvitationsACL extends BaseQueryACL<'invitations'> {
  constructor(ctx: Context) {
    super(ctx, 'invitations');
  }

  canSelect<TReturn>(query: Query<'invitations', Schema, TReturn>): Query<'invitations', Schema, TReturn> {
    // Only ADMIN or OWNER can fetch invitations
    // Direct check using ctx.role - no DB traversal needed
    if (this.ctx.role === WorkspaceRole.ADMIN || this.ctx.role === WorkspaceRole.OWNER) {
      // Admin/Owner see invitations in their workspace
      return query.where('workspaceId', '=', this.ctx.workspaceId);
    }
    
    // Non-admin/owner: return empty result
    return query.where('id', '=', '');
  }
}
