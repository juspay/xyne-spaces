import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class RolesACL extends BaseQueryACL<'roles'> {
  constructor(ctx: Context) {
    super(ctx, 'roles');
  }

  canSelect<TReturn>(query: Query<'roles', Schema, TReturn>): Query<'roles', Schema, TReturn> {
    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where('isActive', '=', true);
  }
}
