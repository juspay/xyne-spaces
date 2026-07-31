import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class RolesACL extends BaseQueryACL<'roles'> {
  constructor(ctx: Context) {
    super(ctx, 'roles');
  }

  canSelect<TReturn>(query: Query<'roles', Schema, TReturn>): Query<'roles', Schema, TReturn> {
    // Scope to workspace only. The old isActive=true filter hid deactivated roles,
    // blanking role labels wherever a mapping still points at one; the query layer
    // that wants active-only should filter it there.
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
