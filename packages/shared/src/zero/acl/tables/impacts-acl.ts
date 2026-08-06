import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ImpactsACL extends BaseQueryACL<'impacts'> {
  constructor(ctx: Context) {
    super(ctx, 'impacts');
  }

  canSelect<TReturn>(query: Query<'impacts', Schema, TReturn>): Query<'impacts', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
