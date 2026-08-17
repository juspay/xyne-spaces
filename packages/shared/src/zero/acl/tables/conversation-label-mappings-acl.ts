import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

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
  ): Query<'conversation_label_mappings', Schema, TReturn> {
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
