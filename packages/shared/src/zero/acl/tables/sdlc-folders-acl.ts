import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class SdlcFoldersACL extends BaseQueryACL<'sdlc_folders'> {
  constructor(ctx: Context) {
    super(ctx, 'sdlc_folders');
  }

  canSelect<TReturn>(
    query: Query<'sdlc_folders', Schema, TReturn>,
  ): Query<'sdlc_folders', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    // A folder carries no scope column; the edge that places it in a track is
    // what places it in a hub, so visibility follows that edge's channel — the
    // same shape as SdlcTracksACL. Any edge will do: a folder always has exactly
    // one containment edge, and it cannot be reached without it.
    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .whereExists('sdlcEntityLinks', (link) =>
        link.whereExists('channel', (channel) =>
          channel.whereExists('participants', (participant) =>
            participant.where('userId', '=', this.ctx.userID),
          ),
        ),
      );
  }
}
