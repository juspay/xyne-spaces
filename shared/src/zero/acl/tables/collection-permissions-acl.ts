import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CollectionPermissionsACL extends BaseQueryACL<'collection_permissions'> {
  constructor(ctx: Context) {
    super(ctx, 'collection_permissions');
  }

  canSelect<TReturn>(query: Query<'collection_permissions', Schema, TReturn>): Query<'collection_permissions', Schema, TReturn> {
    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('userId', '=', this.ctx.userID),
        exists('collection', (c) =>
          c.where('ownerId', this.ctx.userID)
        ),
        exists('collection', (c) =>
          c.whereExists('permissions', (p) => p.where('userId', this.ctx.userID))
        )
      )
    );
  }
}
