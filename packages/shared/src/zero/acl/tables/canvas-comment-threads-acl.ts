import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { CanvasVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CanvasCommentThreadsACL extends BaseQueryACL<'canvas_comment_threads'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_comment_threads');
  }

  canSelect<TReturn>(
    query: Query<'canvas_comment_threads', Schema, TReturn>,
  ): Query<'canvas_comment_threads', Schema, TReturn> {
    // Slack Connect: tenancy comes from the defineQuery backstop (connect_group reach) — no
    // `workspaceId` filter here, so comments on a canvas shared from another workspace stay visible.
    // The canvas-visibility check below still gates which canvas's threads the caller can see.
    return query.whereExists('canvas', canvas =>
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
    );
  }
}
