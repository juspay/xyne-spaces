import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class CollectionsACL extends BaseQueryACL<'collections'> {
  constructor(ctx: Context) {
    super(ctx, 'collections');
  }

  canSelect<TReturn>(query: Query<'collections', Schema, TReturn>): Query<'collections', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where(({ or, cmp, exists }) =>
        or(
          cmp('isPrivate', '=', false),
          cmp('ownerId', '=', this.ctx.userID),
          exists('permissions', (p) => p.where('userId', this.ctx.userID))
        )
      );
  }
}
