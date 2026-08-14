import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class LinksACL extends BaseQueryACL<'links'> {
  constructor(ctx: Context) {
    super(ctx, 'links');
  }

  /**
   * A link belongs to a channel, so it inherits that channel's audience: PUBLIC
   * anywhere in the workspace, or a channel the caller participates in. Guest
   * reach is not expressible as a participant lookup and uses the shared guest
   * predicate instead.
   *
   * The channelLinks query already applies an equivalent gate, so this is a
   * no-op for members. Keeping it on the table means the boundary holds for any
   * future query rather than depending on each caller to repeat it.
   */
  canSelect<TReturn>(query: Query<'links', Schema, TReturn>, args?: SelectArgs): Query<'links', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .whereExists('channel', (ch) =>
          ch
            .where('workspaceId', '=', this.ctx.workspaceId)
            .where(guestChannelAccessWhere(this.ctx)),
        );
    }

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR);
    }

    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .whereExists('channel', (ch) =>
        ch.where(channelAccessWhere(this.ctx)),
      );
  }
}
