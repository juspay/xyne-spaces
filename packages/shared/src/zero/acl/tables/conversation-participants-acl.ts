import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class ConversationParticipantsACL extends BaseQueryACL<'conversation_participants'> {
  constructor(ctx: Context) {
    super(ctx, 'conversation_participants');
  }

  canSelect<TReturn>(
    query: Query<'conversation_participants', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'conversation_participants', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.where(({ or, exists }) =>
        or(
          exists('channel', (ch) =>
            ch.where('workspaceId', '=', this.ctx.workspaceId).where(guestChannelAccessWhere(this.ctx)),
          ),
          exists('conversation', (conversation) =>
            conversation.whereExists('channel', (ch) =>
              ch.where('workspaceId', '=', this.ctx.workspaceId).where(guestChannelAccessWhere(this.ctx)),
            ),
          ),
        ),
      );
    }

    const { channelId } = channelAccessArgs(args);
    if (channelId) {
      return query.where(({ or, exists }) =>
        or(
          exists('channel', scalarChannelBody(this.ctx, channelId, true), SCALAR),
          exists('conversation', (conversation) =>
            conversation
              .where('channelId', channelId)
              .whereExists('channel', scalarChannelBody(this.ctx, channelId, true), SCALAR),
          ),
        ),
      );
    }

    return query.where(({ or, exists }) =>
      or(
        exists('channel', (ch) =>
          ch
            .where('workspaceId', '=', this.ctx.workspaceId)
            .whereExists('participants', (p) => p.where('userId', this.ctx.userID)),
        ),
        exists('conversation', (conversation) =>
          conversation.whereExists('channel', (ch) =>
            ch
              .where('workspaceId', '=', this.ctx.workspaceId)
              .whereExists('participants', (p) => p.where('userId', this.ctx.userID)),
          ),
        ),
      ),
    );
  }
}
