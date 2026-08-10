import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class MessageArtifactsACL extends BaseQueryACL<'message_artifacts'> {
  constructor(ctx: Context) {
    super(ctx, 'message_artifacts');
  }

  canSelect<TReturn>(
    query: Query<'message_artifacts', Schema, TReturn>
  ): Query<'message_artifacts', Schema, TReturn> {
    return query.whereExists('message', (message) =>
      message
        .where(({ or, cmp }) => or(cmp('visibleTo', 'IS', null), cmp('visibleTo', this.ctx.userID)))
        .whereExists('conversation', (conversation) =>
          conversation.whereExists('channel', (channel) => {
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
          })
        )
    );
  }
}
