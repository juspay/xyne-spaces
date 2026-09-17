import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

/**
 * Guest access grants. Workspace scope only, matching the Prisma side.
 */
export class GuestAccessACL extends BaseQueryACL<'guest_access'> {
  constructor(ctx: Context) {
    super(ctx, 'guest_access');
  }

  canSelect<TReturn>(query: Query<'guest_access', Schema, TReturn>): Query<'guest_access', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
