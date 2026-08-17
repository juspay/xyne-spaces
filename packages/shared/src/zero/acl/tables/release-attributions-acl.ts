import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ReleaseAttributionsACL extends BaseQueryACL<'release_attributions'> {
  constructor(ctx: Context) {
    super(ctx, 'release_attributions');
  }

  canSelect<TReturn>(query: Query<'release_attributions', Schema, TReturn>): Query<'release_attributions', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
