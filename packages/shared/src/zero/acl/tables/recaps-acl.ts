import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
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

    // Base recaps (userId IS NULL): only visible when their channel is in the caller's
    // workspace AND the channel is PUBLIC or the caller is a participant.
    // Custom recaps (userId = userID): only visible to the owning user.
    return query.where(({ or, cmp, and, exists }) =>
      or(
        and(
          cmp('userId', 'IS', null),
          exists('channel', (ch) =>
            ch
              .where('workspaceId', '=', this.ctx.workspaceId)
              .where(({ or: or2, cmp: cmp2, exists: exists2 }) =>
                or2(
                  cmp2('visibility', '=', ChannelVisibility.PUBLIC),
                  exists2('participants', (p) => p.where('userId', this.ctx.userID))
                )
              )
          )
        ),
        cmp('userId', '=', this.ctx.userID)
      )
    );
  }
}
