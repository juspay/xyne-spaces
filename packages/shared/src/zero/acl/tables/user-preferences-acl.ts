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
    // user_preferences is per-user private (Ask AI custom instructions,
    // notification keywords/levels). The workspace predicate alone let any
    // member read every colleague's row, so scope reads to the owner.
    return query.where('userId', '=', this.ctx.userID);
  }
}
