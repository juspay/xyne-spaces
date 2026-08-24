import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { connectChannelAccessWhere } from '../core/guest-acl-utils';

export class ChannelBoardMappingsACL extends BaseQueryACL<'channel_board_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'channel_board_mappings');
  }

  // NOTE: 'channel_board_mappings' is opted out of the define-query.ts workspace backstop
  // (Slack-Connect), so every branch must be fully self-scoping. Same-workspace: workspaceId
  // match. Connect: the mapped channel is one where I am an active connect member.
  canSelect<TReturn>(
    query: Query<'channel_board_mappings', Schema, TReturn>,
  ): Query<'channel_board_mappings', Schema, TReturn> {
    return query.where(({ or, cmp, exists }: any) =>
      or(
        cmp('workspaceId', '=', this.ctx.workspaceId),
        exists('channel', (ch: any) => ch.where(connectChannelAccessWhere(this.ctx))),
      ),
    );
  }
}
