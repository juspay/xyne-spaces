import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import {
  guestChannelAccessWhere,
  isGuestContext,
  channelVisibleWhere,
} from '../core/guest-acl-utils';

export class ChannelParticipantsACL extends BaseQueryACL<'channel_participants'> {
  constructor(ctx: Context) {
    super(ctx, 'channel_participants');
  }

  // NOTE: 'channel_participants' is opted out of the define-query.ts workspace backstop (Slack-Connect),
  // so the channel gate carries its own workspaceId and adds active connect membership as an OR.
  canSelect<TReturn>(query: Query<'channel_participants', Schema, TReturn>): Query<'channel_participants', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('channel', (ch) =>
        ch.where(channelVisibleWhere(this.ctx, guestChannelAccessWhere(this.ctx))),
      );
    }

    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('userId', this.ctx.userID),
        exists('channel', (ch) =>
          ch.where(
            channelVisibleWhere(this.ctx, ({ or, cmp, exists }: any) =>
              or(
                cmp('visibility', '=', ChannelVisibility.PUBLIC),
                exists('participants', (p: any) => p.where('userId', this.ctx.userID)),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
