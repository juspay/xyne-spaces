import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class UserProfilesACL extends BaseQueryACL<'user_profiles'> {
  constructor(ctx: Context) {
    super(ctx, 'user_profiles');
  }

  canSelect<TReturn>(
    query: Query<'user_profiles', Schema, TReturn>
  ): Query<'user_profiles', Schema, TReturn> {
    return query.whereExists('user', (u) =>
      u.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
