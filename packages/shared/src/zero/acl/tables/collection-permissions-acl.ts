import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class CollectionPermissionsACL extends BaseQueryACL<'collection_permissions'> {
  constructor(ctx: Context) {
    super(ctx, 'collection_permissions');
  }

  canSelect<TReturn>(query: Query<'collection_permissions', Schema, TReturn>): Query<'collection_permissions', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('userId', '=', this.ctx.userID),
        exists('collection', (c) =>
          c.where(({ or: innerOr, cmp: innerCmp, exists: innerExists }) =>
            innerOr(
              innerCmp('ownerId', '=', this.ctx.userID),
              innerExists('permissions', (p) => p.where('userId', this.ctx.userID))
            )
          )
        )
      )
    );
  }
}
