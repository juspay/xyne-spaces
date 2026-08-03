import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class EmailReadsACL extends BaseQueryACL<'email_reads'> {
  constructor(ctx: Context) {
    super(ctx, 'email_reads');
  }

  canSelect<TReturn>(query: Query<'email_reads', Schema, TReturn>): Query<'email_reads', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
