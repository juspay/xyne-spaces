import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CollectionsACL extends BaseQueryACL<'collections'> {
  constructor(ctx: Context) {
    super(ctx, 'collections');
  }

  canSelect<TReturn>(query: Query<'collections', Schema, TReturn>): Query<'collections', Schema, TReturn> {
    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('ownerId', '=', this.ctx.userID),
        exists('permissions', (p) => p.where('userId', this.ctx.userID))
      )
    );
  }
}
