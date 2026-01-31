import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class NotificationsACL extends BaseQueryACL<'notifications'> {
  constructor(ctx: Context) {
    super(ctx, 'notifications');
  }

  canSelect<TReturn>(query: Query<'notifications', Schema, TReturn>): Query<'notifications', Schema, TReturn> {
    return query.where('userId', this.ctx.userID);
  }
}
