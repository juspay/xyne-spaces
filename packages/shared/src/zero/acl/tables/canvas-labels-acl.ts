import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { CanvasVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestCanvasAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class CanvasLabelsACL extends BaseQueryACL<'canvas_labels'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_labels');
  }

  canSelect<TReturn>(query: Query<'canvas_labels', Schema, TReturn>): Query<'canvas_labels', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .whereExists('canvas', canvas => canvas.where(guestCanvasAccessWhere(this.ctx)));
    }

    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .whereExists('canvas', canvas =>
        canvas.where(({ or, cmp, exists }) =>
          or(
            cmp('createdBy', this.ctx.userID),
            cmp('visibility', '=', CanvasVisibility.PUBLIC),
            exists('participants', participant =>
              participant.where(({ or, cmp, exists: participantExists }) =>
                or(
                  cmp('userId', this.ctx.userID),
                  participantExists('userGroup', userGroup =>
                    userGroup.whereExists('userGroupMappings', mapping =>
                      mapping.where('userId', this.ctx.userID),
                    ),
                  ),
                  participantExists('channel', channel =>
                    channel.whereExists('participants', channelParticipant =>
                      channelParticipant.where('userId', this.ctx.userID),
                    ),
                  ),
                ),
              ),
            ),
            exists('channel', channel =>
              channel.whereExists('participants', participant =>
                participant.where('userId', this.ctx.userID),
              ),
            ),
          ),
        ),
      );
  }
}
