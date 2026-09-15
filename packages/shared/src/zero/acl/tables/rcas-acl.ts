import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class RcasACL extends BaseQueryACL<'rcas'> {
  constructor(ctx: Context) {
    super(ctx, 'rcas');
  }

  canSelect<TReturn>(query: Query<'rcas', Schema, TReturn>): Query<'rcas', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
