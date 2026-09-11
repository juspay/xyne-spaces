import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class SdlcArtifactsACL extends BaseQueryACL<'sdlc_artifacts'> {
  constructor(ctx: Context) {
    super(ctx, 'sdlc_artifacts');
  }

  canSelect<TReturn>(
    query: Query<'sdlc_artifacts', Schema, TReturn>,
  ): Query<'sdlc_artifacts', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'artifactId');
    }

    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      // The artifact's own canvas, not its repository: going through the repository
      // would leak metadata from every other hub that covers it.
      .whereExists('canvas', (canvas) =>
        canvas.whereExists('channel', (channel) =>
          channel.whereExists('participants', (participant) =>
            participant.where('userId', '=', this.ctx.userID),
          ),
        ),
      );
  }
}
