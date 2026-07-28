import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class UserAssignmentStatesACL extends BaseQueryACL<'user_assignment_states'> {
  constructor(ctx: Context) {
    super(ctx, 'user_assignment_states');
  }

  canSelect<TReturn>(
    query: Query<'user_assignment_states', Schema, TReturn>,
  ): Query<'user_assignment_states', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('user', (u) =>
        u
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(({ or, cmp, exists }) =>
            or(
              cmp('id', '=', this.ctx.userID),
              exists('channelParticipations', (cp) =>
                cp.whereExists('channel', (ch) =>
                  ch.where(guestChannelAccessWhere(this.ctx)),
                ),
              ),
            ),
          ),
      );
    }

    return query.whereExists('userGroup', (ug) => ug.where('workspaceId', '=', this.ctx.workspaceId));
  }
}
