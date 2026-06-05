import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CollectionItemsACL extends BaseQueryACL<'collection_items'> {
  constructor(ctx: Context) {
    super(ctx, 'collection_items');
  }

  canSelect<TReturn>(query: Query<'collection_items', Schema, TReturn>): Query<'collection_items', Schema, TReturn> {
    return query.where(({ exists }) =>
      exists('collection', (c) =>
        c.where(({ or, cmp, exists: innerExists }) =>
          or(
            cmp('isPrivate', '=', false),
            cmp('ownerId', '=', this.ctx.userID),
            innerExists('permissions', (p) => p.where('userId', this.ctx.userID))
          )
        )
      )
    );
  }
}
