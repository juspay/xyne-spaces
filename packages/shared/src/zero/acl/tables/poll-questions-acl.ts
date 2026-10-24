import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { pollChannelScope } from './poll-channel-scope';

export class PollQuestionsACL extends BaseQueryACL<'poll_questions'> {
  constructor(ctx: Context) {
    super(ctx, 'poll_questions');
  }

  canSelect<TReturn>(
    query: Query<'poll_questions', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'poll_questions', Schema, TReturn> {
    return query.whereExists('poll', pollChannelScope(this.ctx, args));
  }
}
