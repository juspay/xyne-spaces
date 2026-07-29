import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class UserPresenceACL extends BaseQueryACL<'user_presence'> {
  constructor(ctx: Context) {
    super(ctx, 'user_presence');
  }

  canSelect<TReturn>(query: Query<'user_presence', Schema, TReturn>): Query<'user_presence', Schema, TReturn> {
    // Users can only see their own presence
    return query.where('userId', '=', this.ctx.userID);
  }
}
