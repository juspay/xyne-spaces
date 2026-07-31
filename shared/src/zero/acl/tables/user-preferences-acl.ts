import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class UserPreferencesACL extends BaseQueryACL<'user_preferences'> {
  constructor(ctx: Context) {
    super(ctx, 'user_preferences');
  }

  canSelect<TReturn>(
    query: Query<'user_preferences', Schema, TReturn>
  ): Query<'user_preferences', Schema, TReturn> {
    return query.whereExists('user', (u) =>
      u.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
