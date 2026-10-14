import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { pollChannelScope } from './poll-channel-scope';

export class PollsACL extends BaseQueryACL<'polls'> {
  constructor(ctx: Context) {
    super(ctx, 'polls');
  }

  canSelect<TReturn>(
    query: Query<'polls', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'polls', Schema, TReturn> {
    return pollChannelScope(this.ctx, args)(query);
  }
}
