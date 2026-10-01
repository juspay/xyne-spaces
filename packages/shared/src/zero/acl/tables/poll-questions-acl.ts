import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import {
  SCALAR,
  channelAccessArgs,
  channelAccessWhere,
  scalarChannelBody,
} from '../core/channel-access';
import {
  guestChannelAccessWhere,
  isGuestContext,
} from '../core/guest-acl-utils';

export class PollQuestionsACL extends BaseQueryACL<'poll_questions'> {
  constructor(ctx: Context) {
    super(ctx, 'poll_questions');
  }

  canSelect<TReturn>(
    query: Query<'poll_questions', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'poll_questions', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('poll', (poll) =>
        poll.whereExists('message', (message) =>
          message.whereExists('conversation', (conversation) =>
            conversation.whereExists('channel', (channel) =>
              channel
                .where('workspaceId', '=', this.ctx.workspaceId)
                .where(guestChannelAccessWhere(this.ctx)),
            ),
          ),
        ),
      );
    }

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query.whereExists('poll', (poll) =>
        poll.whereExists('message', (message) =>
          message.whereExists('conversation', (conversation) =>
            conversation
              .where('channelId', channelId)
              .whereExists(
                'channel',
                scalarChannelBody(this.ctx, channelId, isMember),
                SCALAR,
              ),
          ),
        ),
      );
    }

    return query.whereExists('poll', (poll) =>
      poll.whereExists('message', (message) =>
        message.whereExists('conversation', (conversation) =>
          conversation.whereExists('channel', (channel) =>
            channel
              .where('workspaceId', '=', this.ctx.workspaceId)
              .where(channelAccessWhere(this.ctx)),
          ),
        ),
      ),
    );
  }
}
