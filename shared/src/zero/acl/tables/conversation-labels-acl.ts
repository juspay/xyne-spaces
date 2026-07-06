import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

// Labels are private to their creator and live in a channel (desk). A user may read
// a label only when it's theirs (createdBy) AND they can see its channel: either it's
// public or they're a participant (mirrors ConversationLabelMappingsACL).
export class ConversationLabelsACL extends BaseQueryACL<'conversation_labels'> {
  constructor(ctx: Context) {
    super(ctx, 'conversation_labels');
  }

  canSelect<TReturn>(
    query: Query<'conversation_labels', Schema, TReturn>,
  ): Query<'conversation_labels', Schema, TReturn> {
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
