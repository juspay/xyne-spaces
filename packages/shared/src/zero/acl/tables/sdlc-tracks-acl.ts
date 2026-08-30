import type { Query } from '@rocicorp/zero';
import { SDLC_TRACK_MEMBERSHIP_RELATION } from '../../../sdlc';
import type { Context, Schema } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class SdlcTracksACL extends BaseQueryACL<'sdlc_tracks'> {
  constructor(ctx: Context) {
    super(ctx, 'sdlc_tracks');
  }

  canSelect<TReturn>(
    query: Query<'sdlc_tracks', Schema, TReturn>,
  ): Query<'sdlc_tracks', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    // A track carries no scope column; its CHANNEL -> TRACK edge is what places it in a hub.
    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .whereExists('sdlcEntityLinks', (link) =>
        link
          .where('relationType', '=', SDLC_TRACK_MEMBERSHIP_RELATION)
          .whereExists('channel', (channel) =>
            channel.whereExists('participants', (participant) =>
              participant.where('userId', '=', this.ctx.userID),
            ),
          ),
      );
  }
}
