import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';

// A label-on-conversation mapping is shared within the channel (the desk label views
// show all applied labels, not just the caller's). It's readable when the user can see
// the underlying channel: it's public or they're a participant. (Previously gated to
// createdBy, which hid mappings applied by teammates.)
export class ConversationLabelMappingsACL extends BaseQueryACL<'conversation_label_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'conversation_label_mappings');
  }

  canSelect<TReturn>(
    query: Query<'conversation_label_mappings', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'conversation_label_mappings', Schema, TReturn> {
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
