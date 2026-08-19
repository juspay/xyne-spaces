import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class ConversationsACL extends BaseQueryACL<'conversations'> {
  constructor(ctx: Context) {
    super(ctx, 'conversations');
  }

  canSelect<TReturn>(query: Query<'conversations', Schema, TReturn>, args?: SelectArgs): Query<'conversations', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('channel', (ch) =>
        ch
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(guestChannelAccessWhere(this.ctx)),
      );
    }

    const channelId = args?.channelId as string | undefined;

    // Both shortcut branches take the channel from the caller's arguments, so each states the
    // workspace itself rather than leaning on the scope the sync layer adds around the root.
    //
    // When the caller knows the user is a member (pre-checked against channel_user_status),
    // use a scalar EXISTS on channel_participants which resolves once at hydration time
    // instead of the expensive OR(PUBLIC, EXISTS(participants)) evaluated per-row during push.
    if (args?.isMember && channelId) {
      return query.whereExists('channel', (ch) =>
        ch
          .where('workspaceId', '=', this.ctx.workspaceId)
          .whereExists('participants', (p) =>
            p.where('userId', this.ctx.userID).where('channelId', channelId),
            { scalar: true }
          ),
      );
    }

    if (args?.isMember === false && channelId) {
      return query.whereExists('channel', (ch) =>
        ch
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where("id", channelId)
          .where('visibility', ChannelVisibility.PUBLIC),
        {scalar: true}
      );
    }

    return query.whereExists('channel', (ch) =>
      ch
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(({ or, cmp, exists }) =>
          or(
            cmp('visibility', ChannelVisibility.PUBLIC),
            exists('participants', (p) => p.where('userId', this.ctx.userID))
          )
        )
    );
    
  }
}
