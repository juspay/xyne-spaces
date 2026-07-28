import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class RecapsACL extends BaseQueryACL<'recaps'> {
  constructor(ctx: Context) {
    super(ctx, 'recaps');
  }

  canSelect<TReturn>(query: Query<'recaps', Schema, TReturn>): Query<'recaps', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.where(({ or, cmp, exists, and }) =>
        or(
          cmp('userId', '=', this.ctx.userID),
          and(
            cmp('userId', 'IS', null),
            exists('channel', (ch) =>
              ch
                .where('workspaceId', '=', this.ctx.workspaceId)
                .where(guestChannelAccessWhere(this.ctx)),
            )
          )
        )
      );
    }

    // Users can see recaps where:
    // 1. They are the userId (personal recaps)
    // 2. OR it's a base recap (userId IS NULL)
    return query.where(({ cmp, or }) =>
      or(
        cmp('userId', '=', this.ctx.userID),
        cmp('userId', 'IS', null)
      )
    );
  }
}
