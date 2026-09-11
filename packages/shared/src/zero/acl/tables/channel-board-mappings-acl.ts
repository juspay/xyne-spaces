import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ChannelBoardMappingsACL extends BaseQueryACL<'channel_board_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'channel_board_mappings');
  }

  canSelect<TReturn>(
    query: Query<'channel_board_mappings', Schema, TReturn>,
  ): Query<'channel_board_mappings', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
