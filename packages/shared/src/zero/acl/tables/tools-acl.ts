import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ToolsACL extends BaseQueryACL<'tools'> {
  constructor(ctx: Context) {
    super(ctx, 'tools');
  }

  canSelect<TReturn>(query: Query<'tools', Schema, TReturn>): Query<'tools', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
