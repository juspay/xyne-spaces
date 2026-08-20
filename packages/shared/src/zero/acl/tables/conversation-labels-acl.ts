import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';

// Labels are a shared, channel-wide palette (the app fetches ALL labels for a channel,
// e.g. conversationLabelsByChannelId). A user may read a label when they can see its
// channel: it's public or they're a participant. (Previously gated to createdBy, which
// hid teammates' labels in a channel the caller could otherwise fully see.)
export class ConversationLabelsACL extends BaseQueryACL<'conversation_labels'> {
  constructor(ctx: Context) {
    super(ctx, 'conversation_labels');
  }

  canSelect<TReturn>(
    query: Query<'conversation_labels', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'conversation_labels', Schema, TReturn> {
    const channelId = args?.channelId as string | undefined;

    if (args?.isMember && channelId) {
      return query.whereExists('channel', (ch) =>
        ch.whereExists('participants', (p) =>
          p.where('userId', this.ctx.userID).where('channelId', channelId),
          { scalar: true }
        ),
      );
    }

    if (args?.isMember === false && channelId) {
      return query.whereExists('channel', (ch) =>
        ch.where('id', channelId).where('visibility', ChannelVisibility.PUBLIC),
        { scalar: true }
      );
    }

    return query
      .whereExists('channel', (ch) =>
        ch.where(({ or, cmp, exists }) =>
          or(
            cmp('visibility', ChannelVisibility.PUBLIC),
            exists('participants', (p) => p.where('userId', this.ctx.userID)),
          ),
        ),
      );
  }
}
