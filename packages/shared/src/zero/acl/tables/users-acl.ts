import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import {
  guestChannelAccessWhere,
  isGuestContext,
  connectCoMemberUserWhere,
} from '../core/guest-acl-utils';

export class UsersACL extends BaseQueryACL<'users'> {
  constructor(ctx: Context) {
    super(ctx, 'users');
  }

  // NOTE: 'users' is opted out of the define-query.ts workspace backstop (Slack-Connect),
  // so each branch is self-scoping and adds cross-org connect co-members as an OR alternative.
  canSelect<TReturn>(query: Query<'users', Schema, TReturn>): Query<'users', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.where(({ or, and, cmp, exists }) =>
        or(
          and(
            cmp('workspaceId', '=', this.ctx.workspaceId),
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
          ),
          // Foreign users I share a connect channel with.
          connectCoMemberUserWhere(this.ctx)({ exists }),
        ),
      );
    }

    // Same-workspace users, plus foreign users I share a connect channel with.
    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('workspaceId', '=', this.ctx.workspaceId),
        connectCoMemberUserWhere(this.ctx)({ exists }),
      ),
    );
  }
}
