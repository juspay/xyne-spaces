import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class ChannelRecapsACL extends BaseQueryACL<'channel_recaps'> {
  constructor(ctx: Context) {
    super(ctx, 'channel_recaps');
  }

  canSelect<TReturn>(query: Query<'channel_recaps', Schema, TReturn>): Query<'channel_recaps', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.where(({ or, cmp, and, exists }) =>
        or(
          and(
            cmp('userId', 'IS', null),
            exists('channel', (ch) =>
              ch
                .where('workspaceId', '=', this.ctx.workspaceId)
                .where(guestChannelAccessWhere(this.ctx))
            )
          ),
          cmp('userId', '=', this.ctx.userID)
        )
      );
    }

    // Base recaps (userId IS NULL): accessible to channel participants or public channels in the workspace
    // Custom recaps (userId = userID): only accessible to the specific user who owns them
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
