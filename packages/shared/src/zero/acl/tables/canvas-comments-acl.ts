import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { CanvasVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { connectChannelAccessWhere } from '../core/guest-acl-utils';

export class CanvasCommentsACL extends BaseQueryACL<'canvas_comments'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_comments');
  }

  // Slack-Connect: a comment is also visible when its canvas's channel is a connect channel I
  // actively belong to (canvas -> channel). canvas_comments has no workspaceId column, so no
  // define-query backstop applies here.
  canSelect<TReturn>(
    query: Query<'canvas_comments', Schema, TReturn>,
  ): Query<'canvas_comments', Schema, TReturn> {
    return query.whereExists('thread', thread =>
      thread.whereExists('canvas', canvas =>
        canvas.where(({ or, cmp, exists }) =>
          or(
            cmp('createdBy', this.ctx.userID),
            cmp('visibility', CanvasVisibility.PUBLIC),
            exists('participants', participant =>
              participant.where(({ or, cmp, exists }) =>
                or(
                  cmp('userId', this.ctx.userID),
                  exists('userGroup', userGroup =>
                    userGroup.whereExists('userGroupMappings', mapping =>
                      mapping.where('userId', this.ctx.userID),
                    ),
                  ),
                  exists('channel', channel =>
                    channel.whereExists('participants', channelParticipant =>
                      channelParticipant.where('userId', this.ctx.userID),
                    ),
                  ),
                ),
              ),
            ),
            exists('channel', (channel: any) =>
              channel.where(connectChannelAccessWhere(this.ctx)),
            ),
          ),
        ),
      ),
    );
  }
}
