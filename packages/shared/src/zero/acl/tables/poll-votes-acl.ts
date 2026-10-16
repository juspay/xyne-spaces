import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { pollChannelScope } from './poll-channel-scope';

/** Ballots are readable by their voter, and by the creator of a non-anonymous poll. */
export class PollVotesACL extends BaseQueryACL<'poll_votes'> {
  constructor(ctx: Context) {
    super(ctx, 'poll_votes');
  }

  canSelect<TReturn>(
    query: Query<'poll_votes', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'poll_votes', Schema, TReturn> {
    return query
      .whereExists('poll', pollChannelScope(this.ctx, args))
      .where(({ or, cmp, exists }) =>
        or(
          cmp('userId', '=', this.ctx.userID),
          exists('poll', (poll) =>
            poll
              .where('createdBy', '=', this.ctx.userID)
              .where('isAnonymous', '=', false),
          ),
        ),
      );
  }
}
