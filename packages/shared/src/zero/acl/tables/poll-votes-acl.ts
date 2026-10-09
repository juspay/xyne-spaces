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

export class PollVotesACL extends BaseQueryACL<'poll_votes'> {
  constructor(ctx: Context) {
    super(ctx, 'poll_votes');
  }

  canSelect<TReturn>(
    query: Query<'poll_votes', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'poll_votes', Schema, TReturn> {
    const restrictIdentity = (scoped: Query<'poll_votes', Schema, TReturn>) =>
      scoped.where(({ or, cmp, exists }) =>
        or(
          cmp('userId', '=', this.ctx.userID),
          exists('poll', (poll) =>
            poll
              .where('createdBy', '=', this.ctx.userID)
              .where('isAnonymous', '=', false),
          ),
        ),
      );

    if (isGuestContext(this.ctx)) {
      return restrictIdentity(
        query.whereExists('poll', (poll) =>
          poll.whereExists('message', (message) =>
            message.whereExists('conversation', (conversation) =>
              conversation.whereExists('channel', (channel) =>
                channel
                  .where('workspaceId', '=', this.ctx.workspaceId)
                  .where(guestChannelAccessWhere(this.ctx)),
              ),
            ),
          ),
        ),
      );
    }

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return restrictIdentity(
        query.whereExists('poll', (poll) =>
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
        ),
      );
    }

    return restrictIdentity(
      query.whereExists('poll', (poll) =>
        poll.whereExists('message', (message) =>
          message.whereExists('conversation', (conversation) =>
            conversation.whereExists('channel', (channel) =>
              channel
                .where('workspaceId', '=', this.ctx.workspaceId)
                .where(channelAccessWhere(this.ctx)),
            ),
          ),
        ),
      ),
    );
  }
}
