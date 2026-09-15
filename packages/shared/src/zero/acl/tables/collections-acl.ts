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
          exists('permissions', (p) => p.where('userId', this.ctx.userID)),
          // Group grants — resolveCollectionAccess (REST/MCP) already honours
          // these via userGroupId; without this, a group-only grant would
          // authorize the REST path but Zero would silently filter the
          // collection out of that user's sync, so it would never show up in
          // the KB UI. Mirrors canvas-participants-acl.ts's group check.
          exists('permissions', (p) =>
            p.whereExists('userGroup', (ug) =>
              ug.whereExists('userGroupMappings', (m) => m.where('userId', this.ctx.userID)),
            ),
          ),
          // Channel grants — same reasoning as the group check above, for a
          // permission row keyed by channelId instead of userGroupId.
          // Mirrors canvas-participants-acl.ts's own channel check.
          exists('permissions', (p) =>
            p.whereExists('channel', (ch) =>
              ch.whereExists('participants', (cp) => cp.where('userId', this.ctx.userID)),
            ),
          ),
        )
      );
  }
}
