import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class LinksACL extends BaseQueryACL<'links'> {
  constructor(ctx: Context) {
    super(ctx, 'links');
  }

  canSelect<TReturn>(query: Query<'links', Schema, TReturn>): Query<'links', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
