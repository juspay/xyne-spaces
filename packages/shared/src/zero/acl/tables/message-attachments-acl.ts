import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import {
  guestChannelAccessWhere,
  isGuestContext,
  channelVisibleWhere,
} from '../core/guest-acl-utils';

export class MessageAttachmentsACL extends BaseQueryACL<'message_attachments'> {
  constructor(ctx: Context) {
    super(ctx, 'message_attachments');
  }

  // NOTE: 'message_attachments' is opted out of the define-query.ts workspace backstop (Slack-Connect).
  // Visible = I created it, OR its conversation's channel is visible to me (same-workspace rule OR
  // active connect membership via channelVisibleWhere). The root workspaceId clamp is dropped because
  // a connect attachment lives in the host workspace; channelVisibleWhere self-scopes the same-ws case.
  canSelect<TReturn>(query: Query<'message_attachments', Schema, TReturn>): Query<'message_attachments', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.where(({ or, cmp, exists }) =>
        or(
          cmp('createdBy', '=', this.ctx.userID),
          exists('conversation', (c) =>
            c.whereExists('channel', (ch) =>
              ch.where(channelVisibleWhere(this.ctx, guestChannelAccessWhere(this.ctx))),
            ),
          ),
        ),
      );
    }

    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('createdBy', '=', this.ctx.userID),
        exists('conversation', (c) =>
          c.whereExists('channel', (ch) =>
            ch.where(
              channelVisibleWhere(this.ctx, ({ or: or2, cmp: cmp2, exists: exists2 }: any) =>
                or2(
                  cmp2('visibility', '=', ChannelVisibility.PUBLIC),
                  exists2('participants', (p: any) => p.where('userId', this.ctx.userID)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
