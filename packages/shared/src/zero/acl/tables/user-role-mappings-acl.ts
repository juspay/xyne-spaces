import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class UserRoleMappingsACL extends BaseQueryACL<'user_role_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'user_role_mappings');
  }

  canSelect<TReturn>(query: Query<'user_role_mappings', Schema, TReturn>): Query<'user_role_mappings', Schema, TReturn> {
    return query.whereExists('role', (roleQuery) =>
      roleQuery.where('workspaceId', '=', this.ctx.workspaceId),
    );
  }
}
