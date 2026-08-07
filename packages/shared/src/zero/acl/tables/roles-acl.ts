import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class RolesACL extends BaseQueryACL<'roles'> {
  constructor(ctx: Context) {
    super(ctx, 'roles');
  }

  canSelect<TReturn>(query: Query<'roles', Schema, TReturn>): Query<'roles', Schema, TReturn> {
    // Scope to workspace only. Callers that want active-only roles filter that at the
    // query layer.
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
