import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ApplicationsACL extends BaseQueryACL<'applications'> {
  constructor(ctx: Context) {
    super(ctx, 'applications');
  }

  canSelect<TReturn>(query: Query<'applications', Schema, TReturn>): Query<'applications', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
