import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import {
  guestChannelAccessWhere,
  isGuestContext,
  channelVisibleWhere,
} from '../core/guest-acl-utils';

export class ConversationParticipantsACL extends BaseQueryACL<'conversation_participants'> {
  constructor(ctx: Context) {
    super(ctx, 'conversation_participants');
  }

  // NOTE: 'conversation_participants' is opted out of the define-query.ts workspace backstop (Slack-Connect).
  canSelect<TReturn>(
    query: Query<'conversation_participants', Schema, TReturn>,
  ): Query<'conversation_participants', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.where(({ or, exists }) =>
        or(
          exists('channel', (ch) =>
            ch.where(channelVisibleWhere(this.ctx, guestChannelAccessWhere(this.ctx))),
          ),
          exists('conversation', (conversation) =>
            conversation.whereExists('channel', (ch) =>
              ch.where(channelVisibleWhere(this.ctx, guestChannelAccessWhere(this.ctx))),
            ),
          ),
        ),
      );
    }

    const memberBase = ({ exists }: any) =>
      exists('participants', (p: any) => p.where('userId', this.ctx.userID));

    return query.where(({ or, exists }) =>
      or(
        exists('channel', (ch) => ch.where(channelVisibleWhere(this.ctx, memberBase))),
        exists('conversation', (conversation) =>
          conversation.whereExists('channel', (ch) =>
            ch.where(channelVisibleWhere(this.ctx, memberBase)),
          ),
        ),
      ),
    );
  }
}
