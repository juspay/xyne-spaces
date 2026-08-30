import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class SdlcEntityLinksACL extends BaseQueryACL<'sdlc_entity_links'> {
  constructor(ctx: Context) {
    super(ctx, 'sdlc_entity_links');
  }

  canSelect<TReturn>(
    query: Query<'sdlc_entity_links', Schema, TReturn>,
  ): Query<'sdlc_entity_links', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    // Links are channel-scoped: channelId is the only scope they carry.
    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .whereExists('channel', (channel) =>
        channel.whereExists('participants', (participant) =>
          participant.where('userId', '=', this.ctx.userID),
        ),
      );
  }
}
