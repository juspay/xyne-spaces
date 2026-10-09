import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class PollJobsACL extends BaseQueryACL<'poll_jobs'> {
  constructor(ctx: Context) {
    super(ctx, 'poll_jobs');
  }

  canSelect<TReturn>(query: Query<'poll_jobs', Schema, TReturn>): Query<'poll_jobs', Schema, TReturn> {
    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .whereExists('poll', poll => poll.where('createdBy', '=', this.ctx.userID));
  }
}
