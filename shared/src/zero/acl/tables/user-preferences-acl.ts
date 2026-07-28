import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { isGuestContext } from '../core/guest-acl-utils';

export class UserPreferencesACL extends BaseQueryACL<'user_preferences'> {
  constructor(ctx: Context) {
    super(ctx, 'user_preferences');
  }

  canSelect<TReturn>(
    query: Query<'user_preferences', Schema, TReturn>
  ): Query<'user_preferences', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.where('userId', '=', this.ctx.userID);
    }

    return query.whereExists('user', (u) =>
      u.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
