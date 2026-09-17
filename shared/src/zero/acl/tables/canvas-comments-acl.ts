import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { CanvasVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CanvasCommentsACL extends BaseQueryACL<'canvas_comments'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_comments');
  }

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
          ),
        ),
      ),
    );
  }
}
