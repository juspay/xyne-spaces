import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
export class PullRequestsACL extends BaseQueryACL<'pull_requests'> {
  constructor(ctx: Context) {
    super(ctx, 'pull_requests');
  }

  canSelect<TReturn>(query: Query<'pull_requests', Schema, TReturn>): Query<'pull_requests', Schema, TReturn> {
    return query;
  }
}
