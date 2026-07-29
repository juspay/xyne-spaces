import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

// A label-on-conversation mapping is private to the agent who applied it. It's
// readable only when it's theirs (createdBy) AND they can see the underlying channel:
// either it's a public channel or the user is a participant.
export class ConversationLabelMappingsACL extends BaseQueryACL<'conversation_label_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'conversation_label_mappings');
  }

  canSelect<TReturn>(
    query: Query<'conversation_label_mappings', Schema, TReturn>,
  ): Query<'conversation_label_mappings', Schema, TReturn> {
    return query
      .where('createdBy', this.ctx.userID)
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
