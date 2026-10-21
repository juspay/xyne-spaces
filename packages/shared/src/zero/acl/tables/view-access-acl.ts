import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ViewAccessEntityType } from '../../types';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class ViewAccessACL extends BaseQueryACL<'view_access'> {
  constructor(ctx: Context) {
    super(ctx, 'view_access');
  }

  canSelect<TReturn>(
    query: Query<'view_access', Schema, TReturn>,
  ): Query<'view_access', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    return query.where(({ or, and, cmp, exists }) =>
      or(
        // Directly shared with me
        and(
          cmp('entityType', '=', ViewAccessEntityType.USER),
          cmp('entityId', '=', this.ctx.userID),
        ),
        // Shared with a channel I'm a member of (entityId holds the channelId)
        and(
          cmp('entityType', '=', ViewAccessEntityType.CHANNEL),
          exists('channel', (ch: any) =>
            ch.whereExists('participants', (p: any) => p.where('userId', this.ctx.userID)),
          ),
        ),
        // Grants I created (as the sharer)
        cmp('sharedBy', '=', this.ctx.userID),
      ),
    );
  }
}
