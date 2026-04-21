import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class FormsACL extends BaseQueryACL<'forms'> {
  constructor(ctx: Context) {
    super(ctx, 'forms');
  }

  canSelect<TReturn>(
    query: Query<'forms', Schema, TReturn>
  ): Query<'forms', Schema, TReturn> {
    // Direct workspaceId check - no need to traverse through createdByUser
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
