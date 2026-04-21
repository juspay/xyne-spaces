import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ConversationParticipantsACL extends BaseQueryACL<'conversation_participants'> {
  constructor(ctx: Context) {
    super(ctx, 'conversation_participants');
  }

  canSelect<TReturn>(query: Query<'conversation_participants', Schema, TReturn>): Query<'conversation_participants', Schema, TReturn> {
    return query.whereExists('conversation', (c) =>
      c.whereExists('channel', (ch) =>
        ch
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(({ or, cmp, exists }) =>
            or(
              cmp('visibility', ChannelVisibility.PUBLIC),
              exists('participants', (p) => p.where('userId', this.ctx.userID))
            )
          )
      )
    );
  }
}
