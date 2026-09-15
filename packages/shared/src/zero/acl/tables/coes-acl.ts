import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CoesACL extends BaseQueryACL<'coes'> {
  constructor(ctx: Context) {
    super(ctx, 'coes');
  }

  canSelect<TReturn>(query: Query<'coes', Schema, TReturn>): Query<'coes', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
