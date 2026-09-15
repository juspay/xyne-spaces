import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class ReactionsACL extends BaseQueryACL<'reactions'> {
  constructor(ctx: Context) {
    super(ctx, 'reactions');
  }

  canSelect<TReturn>(query: Query<'reactions', Schema, TReturn>, args?: SelectArgs): Query<'reactions', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('message', (m) =>
        m.whereExists('conversation', (c) =>
          c.whereExists('channel', (ch) =>
            ch
              .where('workspaceId', '=', this.ctx.workspaceId)
              .where(guestChannelAccessWhere(this.ctx)),
          )
        )
      );
    }

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query.whereExists('message', (m) =>
        m.whereExists('conversation', (c) =>
          c
            .where('channelId', channelId)
            .whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR)
        )
      );
    }

    return query.whereExists('message', (m) =>
      m.whereExists('conversation', (c) =>
        c.whereExists('channel', (ch) =>
          ch
            .where('workspaceId', '=', this.ctx.workspaceId)
            .where(channelAccessWhere(this.ctx))
        )
      )
    );
  }
}
