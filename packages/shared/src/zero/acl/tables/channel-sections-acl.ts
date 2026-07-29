import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ChannelSectionsACL extends BaseQueryACL<'channel_sections'> {
  constructor(ctx: Context) {
    super(ctx, 'channel_sections');
  }

  canSelect<TReturn>(query: Query<'channel_sections', Schema, TReturn>): Query<'channel_sections', Schema, TReturn> {
    return query
      .where('userId', '=', this.ctx.userID)
      .where('workspaceId', '=', this.ctx.workspaceId);
  }
}
