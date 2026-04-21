import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ReactionCountsACL extends BaseQueryACL<'reaction_counts'> {
  constructor(ctx: Context) {
    super(ctx, 'reaction_counts');
  }

  canSelect<TReturn>(query: Query<'reaction_counts', Schema, TReturn>): Query<'reaction_counts', Schema, TReturn> {
    return query.whereExists('message', (messageQ) =>
      messageQ.whereExists('conversation', (cq) =>
        cq.whereExists('channel', (chQ) =>
          chQ
            .where('workspaceId', '=', this.ctx.workspaceId)
            .where(({ or, exists, cmp }) =>
              or(
                cmp('visibility', ChannelVisibility.PUBLIC),
                exists('participants', (p) => p.where('userId', this.ctx.userID))
              )
            )
        )
      )
    );
  }
}
