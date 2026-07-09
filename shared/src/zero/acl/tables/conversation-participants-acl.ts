import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ConversationParticipantsACL extends BaseQueryACL<'conversation_participants'> {
  constructor(ctx: Context) {
    super(ctx, 'conversation_participants');
  }

  canSelect<TReturn>(query: Query<'conversation_participants', Schema, TReturn>): Query<'conversation_participants', Schema, TReturn> {
    return query.where(({ or, exists }) =>
      or(
        // Fast path for new rows with denormalized conversation_participants.channelId.
        exists('channel', (ch) =>
          ch
            .where('workspaceId', '=', this.ctx.workspaceId)
            .whereExists('participants', (p) => p.where('userId', this.ctx.userID))
        ),
        // Compatibility path for older rows where channelId was not written yet.
        exists('conversation', (conversation) =>
          conversation.whereExists('channel', (ch) =>
            ch
              .where('workspaceId', '=', this.ctx.workspaceId)
              .whereExists('participants', (p) => p.where('userId', this.ctx.userID))
          )
        )
      )
    );
  }
}
