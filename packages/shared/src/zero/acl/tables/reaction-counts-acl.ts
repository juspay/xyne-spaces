import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class ReactionCountsACL extends BaseQueryACL<'reaction_counts'> {
  constructor(ctx: Context) {
    super(ctx, 'reaction_counts');
  }

  canSelect<TReturn>(query: Query<'reaction_counts', Schema, TReturn>, args?: SelectArgs): Query<'reaction_counts', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('message', (messageQ) =>
        messageQ.whereExists('conversation', (cq) =>
          cq.whereExists('channel', (chQ) =>
            chQ
              .where('workspaceId', '=', this.ctx.workspaceId)
              .where(guestChannelAccessWhere(this.ctx)),
          )
        )
      );
    }

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query.whereExists('message', (messageQ) =>
        messageQ.whereExists('conversation', (cq) =>
          cq
            .where('channelId', channelId)
            .whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR)
        )
      );
    }

    return query.whereExists('message', (messageQ) =>
      messageQ.whereExists('conversation', (cq) =>
        cq.whereExists('channel', (chQ) =>
          chQ
            .where('workspaceId', '=', this.ctx.workspaceId)
            .where(channelAccessWhere(this.ctx))
        )
      )
    );
  }
}
