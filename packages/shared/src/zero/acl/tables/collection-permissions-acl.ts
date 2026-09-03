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
              innerExists('permissions', (p) => p.where('userId', this.ctx.userID)),
              // Group grants — mirrors CollectionsACL's own group check, so a
              // group-granted user can see the Share modal's "Who has access"
              // list instead of it silently resolving empty.
              innerExists('permissions', (p) =>
                p.whereExists('userGroup', (ug) =>
                  ug.whereExists('userGroupMappings', (m) => m.where('userId', this.ctx.userID)),
                ),
              ),
              // Channel grants — same reasoning as the group check above.
              innerExists('permissions', (p) =>
                p.whereExists('channel', (ch) =>
                  ch.whereExists('participants', (cp) => cp.where('userId', this.ctx.userID)),
                ),
              ),
            )
          )
        )
      )
    );
  }
}
