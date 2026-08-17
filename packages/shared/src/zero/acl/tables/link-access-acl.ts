import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class LinkAccessACL extends BaseQueryACL<'link_access'> {
  constructor(ctx: Context) {
    super(ctx, 'link_access');
  }

  canSelect<TReturn>(query: Query<'link_access', Schema, TReturn>): Query<'link_access', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
