import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import type { SelectArgs } from '../core/types';
import {
  SCALAR,
  channelAccessArgs,
  channelAccessWhere,
  scalarChannelBody,
} from '../core/channel-access';
import {
  guestChannelAccessWhere,
  isGuestContext,
} from '../core/guest-acl-utils';

/**
 * Limits a polls query to polls whose message sits in a channel the viewer can read.
 * Every poll table reaches the channel through its poll, so the other poll ACLs wrap
 * this in `whereExists('poll', …)`.
 */
export function pollChannelScope(ctx: Context, args?: SelectArgs) {
  return <TReturn>(poll: Query<'polls', Schema, TReturn>): Query<'polls', Schema, TReturn> => {
    if (isGuestContext(ctx)) {
      return poll.whereExists('message', (message) =>
        message.whereExists('conversation', (conversation) =>
          conversation.whereExists('channel', (channel) =>
            channel
              .where('workspaceId', '=', ctx.workspaceId)
              .where(guestChannelAccessWhere(ctx)),
          ),
        ),
      );
    }

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return poll.whereExists('message', (message) =>
        message.whereExists('conversation', (conversation) =>
          conversation
            .where('channelId', channelId)
            .whereExists('channel', scalarChannelBody(ctx, channelId, isMember), SCALAR),
        ),
      );
    }

    return poll.whereExists('message', (message) =>
      message.whereExists('conversation', (conversation) =>
        conversation.whereExists('channel', (channel) =>
          channel
            .where('workspaceId', '=', ctx.workspaceId)
            .where(channelAccessWhere(ctx)),
        ),
      ),
    );
  };
}
