import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ChannelUserStatusACL extends BaseQueryACL<'channel_user_status'> {
  constructor(ctx: Context) {
    super(ctx, 'channel_user_status');
  }

  canSelect<TReturn>(query: Query<'channel_user_status', Schema, TReturn>): Query<'channel_user_status', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
