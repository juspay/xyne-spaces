import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class UsersACL extends BaseQueryACL<'users'> {
  constructor(ctx: Context) {
    super(ctx, 'users');
  }

  canSelect<TReturn>(query: Query<'users', Schema, TReturn>): Query<'users', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(({ or, cmp, exists }) =>
          or(
            cmp('id', '=', this.ctx.userID),
            exists('channelParticipations', (cp) =>
              cp.whereExists('channel', (ch) =>
                ch
                  .where('workspaceId', '=', this.ctx.workspaceId)
                  .where(guestChannelAccessWhere(this.ctx)),
                ),
              ),
            ),
          );
    }

    // All users are visible to authenticated users within the same workspace
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
