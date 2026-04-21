import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class BoardsACL extends BaseQueryACL<'boards'> {
  constructor(ctx: Context) {
    super(ctx, 'boards');
  }

  canSelect<TReturn>(query: Query<'boards', Schema, TReturn>): Query<'boards', Schema, TReturn> {
    // Direct workspaceId check - no need to traverse through project
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}

