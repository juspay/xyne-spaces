import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ConversationsACL extends BaseQueryACL<'conversations'> {
  constructor(ctx: Context) {
    super(ctx, 'conversations');
  }

  canSelect<TReturn>(query: Query<'conversations', Schema, TReturn>): Query<'conversations', Schema, TReturn> {
    return query.whereExists('channel', (ch) =>
      ch.where(({ or, cmp, exists }) =>
        or(
          cmp('visibility', ChannelVisibility.PUBLIC),
          exists('participants', (p) => p.where('userId', this.ctx.userID))
        )
      )
    );
  }
}
