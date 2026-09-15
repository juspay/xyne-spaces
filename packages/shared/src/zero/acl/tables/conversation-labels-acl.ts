import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';

// Labels are private to their creator and live in a channel (desk). A user may read
// a label only when it's theirs (createdBy) AND they can see its channel: either it's
// public or they're a participant (mirrors ConversationLabelMappingsACL).
export class ConversationLabelsACL extends BaseQueryACL<'conversation_labels'> {
  constructor(ctx: Context) {
    super(ctx, 'conversation_labels');
  }

  canSelect<TReturn>(
    query: Query<'conversation_labels', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'conversation_labels', Schema, TReturn> {
    const own = query.where('createdBy', this.ctx.userID);

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return own.whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR);
    }

    return own.whereExists('channel', (ch) =>
      ch.where(channelAccessWhere(this.ctx)),
    );
  }
}
