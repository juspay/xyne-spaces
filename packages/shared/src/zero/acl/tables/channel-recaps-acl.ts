import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class ChannelRecapsACL extends BaseQueryACL<'channel_recaps'> {
  constructor(ctx: Context) {
    super(ctx, 'channel_recaps');
  }

  canSelect<TReturn>(query: Query<'channel_recaps', Schema, TReturn>, args?: SelectArgs): Query<'channel_recaps', Schema, TReturn> {
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
    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query.where(({ or, cmp, and, exists }) =>
        or(
          and(
            cmp('userId', 'IS', null),
            exists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR)
          ),
          cmp('userId', '=', this.ctx.userID)
        )
      );
    }

    return query.where(({ or, cmp, and, exists }) =>
      or(
        and(
          cmp('userId', 'IS', null),
          exists('channel', (ch) =>
            ch
              .where('workspaceId', '=', this.ctx.workspaceId)
              .where(channelAccessWhere(this.ctx))
          )
        ),
        cmp('userId', '=', this.ctx.userID)
      )
    );
  }
}
