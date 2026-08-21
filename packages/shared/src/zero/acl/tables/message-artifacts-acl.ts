import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

/**
 * Mirrors the channel rule in MessagesACL. It cannot delegate to it: doing so
 * needs a `messages` relationship on this table, which would pull every message
 * delta into the global artifact subscription's pipeline.
 *
 * The visibility check MessagesACL applies (`visibleTo`) has no counterpart
 * here because artifact rows are never written for visibility-restricted
 * messages — see syncMessageArtifact in the backend, which deletes the row if a
 * message ever becomes restricted.
 */
export class MessageArtifactsACL extends BaseQueryACL<'message_artifacts'> {
  constructor(ctx: Context) {
    super(ctx, 'message_artifacts');
  }

  canSelect<TReturn>(
    query: Query<'message_artifacts', Schema, TReturn>
  ): Query<'message_artifacts', Schema, TReturn> {
    return query.whereExists('channel', (channel) => {
      const scoped = channel.where('workspaceId', '=', this.ctx.workspaceId);
      if (isGuestContext(this.ctx)) {
        return scoped.where(guestChannelAccessWhere(this.ctx));
      }
      return scoped.where(({ or, cmp, exists }) =>
        or(
          cmp('visibility', '=', ChannelVisibility.PUBLIC),
          exists('participants', (participant) =>
            participant.where('userId', this.ctx.userID)
          )
        )
      );
    });
  }
}
