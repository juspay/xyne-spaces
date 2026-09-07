import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';

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
    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query.whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR);
    }

    return query
      .whereExists('channel', (ch) =>
        ch.where(channelAccessWhere(this.ctx)),
      );
  }
}
