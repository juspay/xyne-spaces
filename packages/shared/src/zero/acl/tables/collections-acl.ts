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

    // workspaceId is a denormalized tenant key stamped on insert (nullable —
    // see schema.ts), so rows predating the backfill may have it unset.
    // Treat those as visible everywhere (unchanged legacy behavior) while
    // enforcing the match for anything that does carry a workspaceId.
    return query
      .where(({ or, cmp }) =>
        or(cmp('workspaceId', 'IS', null), cmp('workspaceId', '=', this.ctx.workspaceId))
      )
      .where(({ or, cmp, exists }) =>
        or(
          cmp('isPrivate', '=', false),
          cmp('ownerId', '=', this.ctx.userID),
          exists('permissions', (p) => p.where('userId', this.ctx.userID))
        )
      );
  }
}
