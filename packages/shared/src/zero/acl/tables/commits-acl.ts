import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CommitsACL extends BaseQueryACL<'commits'> {
  constructor(ctx: Context) {
    super(ctx, 'commits');
  }

  canSelect<TReturn>(query: Query<'commits', Schema, TReturn>): Query<'commits', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
