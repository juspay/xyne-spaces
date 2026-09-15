import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class ConversationsACL extends BaseQueryACL<'conversations'> {
  constructor(ctx: Context) {
    super(ctx, 'conversations');
  }

  canSelect<TReturn>(query: Query<'conversations', Schema, TReturn>, args?: SelectArgs): Query<'conversations', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('channel', (ch) =>
        ch
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(guestChannelAccessWhere(this.ctx)),
      );
    }

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query.whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR);
    }

    return query.whereExists('channel', (ch) =>
      ch
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(channelAccessWhere(this.ctx))
    );
  }
}
