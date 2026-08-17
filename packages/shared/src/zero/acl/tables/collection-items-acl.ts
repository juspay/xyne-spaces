import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class CollectionItemsACL extends BaseQueryACL<'collection_items'> {
  constructor(ctx: Context) {
    super(ctx, 'collection_items');
  }

  canSelect<TReturn>(query: Query<'collection_items', Schema, TReturn>): Query<'collection_items', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    // Checked on the item's own denormalized workspaceId rather than hopping
    // through `collection` since both copies are independently stamped at
    // insert and neither is more authoritative than the other.
    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where(({ exists }) =>
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
