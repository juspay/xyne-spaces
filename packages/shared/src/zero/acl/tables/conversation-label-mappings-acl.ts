import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';

// A label-on-conversation mapping is private to the agent who applied it. It's
// readable only when it's theirs (createdBy) AND they can see the underlying channel:
// either it's a public channel or the user is a participant.
export class ConversationLabelMappingsACL extends BaseQueryACL<'conversation_label_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'conversation_label_mappings');
  }

  canSelect<TReturn>(
    query: Query<'conversation_label_mappings', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'conversation_label_mappings', Schema, TReturn> {
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
