import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import {
  guestChannelAccessWhere,
  isGuestContext,
  channelVisibleWhere,
  connectChannelAccessWhere,
} from '../core/guest-acl-utils';

export class ConversationsACL extends BaseQueryACL<'conversations'> {
  constructor(ctx: Context) {
    super(ctx, 'conversations');
  }

  // NOTE: 'conversations' is opted out of the define-query.ts workspace backstop (Slack-Connect),
  // so every branch must be fully self-scoping (no reliance on a root workspaceId re-clamp).
  canSelect<TReturn>(query: Query<'conversations', Schema, TReturn>, args?: SelectArgs): Query<'conversations', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('channel', (ch) =>
        ch.where(channelVisibleWhere(this.ctx, guestChannelAccessWhere(this.ctx))),
      );
    }

    const channelId = args?.channelId as string | undefined;

    // When the caller knows the user is a member (pre-checked against channel_user_status),
    // use a scalar EXISTS on channel_participants which resolves once at hydration time
    // instead of the expensive OR(PUBLIC, EXISTS(participants)) evaluated per-row during push.
    // Membership is itself the tenant gate (a participant may be cross-org for connect channels).
    // Also allow active connect members: the caller derives `isMember` from the guest's LOCAL
    // pointer channel status, so for a connect HOST channel `isMember` may be false even though
    // the user is a legitimate connect member — connect access must be checked here regardless.
    if (args?.isMember && channelId) {
      return query.whereExists('channel', (ch) =>
        ch.where(({ or, exists }: any) =>
          or(
            exists('participants', (p: any) =>
              p.where('userId', this.ctx.userID).where('channelId', channelId),
            ),
            connectChannelAccessWhere(this.ctx)({ exists }),
          ),
        ),
      );
    }

    // Non-member viewing a PUBLIC channel. This branch previously leaned on the workspace
    // backstop for tenant isolation; now that 'conversations' opts out, it must scope itself.
    // channelVisibleWhere keeps same-workspace public visibility AND admits active connect
    // members (whose `isMember` is false because their status lives on the pointer channel).
    if (args?.isMember === false && channelId) {
      return query.whereExists('channel', (ch) =>
        ch
          .where('id', channelId)
          .where(
            channelVisibleWhere(this.ctx, ({ cmp }: any) =>
              cmp('visibility', '=', ChannelVisibility.PUBLIC),
            ),
          ),
      );
    }

    return query.whereExists('channel', (ch) =>
      ch.where(
        channelVisibleWhere(this.ctx, ({ or, cmp, exists }: any) =>
          or(
            cmp('visibility', ChannelVisibility.PUBLIC),
            exists('participants', (p: any) => p.where('userId', this.ctx.userID)),
          ),
        ),
      ),
    );

  }
}
