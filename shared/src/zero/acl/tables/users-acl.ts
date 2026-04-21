import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class UsersACL extends BaseQueryACL<'users'> {
  constructor(ctx: Context) {
    super(ctx, 'users');
  }

  canSelect<TReturn>(query: Query<'users', Schema, TReturn>): Query<'users', Schema, TReturn> {
    // All users are visible to authenticated users within the same workspace
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
