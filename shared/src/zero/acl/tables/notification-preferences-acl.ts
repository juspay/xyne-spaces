import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class NotificationPreferencesACL extends BaseQueryACL<'notification_preferences'> {
  constructor(ctx: Context) {
    super(ctx, 'notification_preferences');
  }

  canSelect<TReturn>(query: Query<'notification_preferences', Schema, TReturn>): Query<'notification_preferences', Schema, TReturn> {
    return query.where('userId', this.ctx.userID);
  }
}
