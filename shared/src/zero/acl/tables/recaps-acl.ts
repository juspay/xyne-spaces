import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class RecapsACL extends BaseQueryACL<'recaps'> {
  constructor(ctx: Context) {
    super(ctx, 'recaps');
  }

  canSelect<TReturn>(query: Query<'recaps', Schema, TReturn>, args?: SelectArgs): Query<'recaps', Schema, TReturn> {
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
