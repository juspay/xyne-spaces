import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { RoomMemberStatus, RoomRecapStatus, RoomRole } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class RoomRecapsACL extends BaseQueryACL<'room_recaps'> {
  constructor(ctx: Context) {
    super(ctx, 'room_recaps');
  }

  canSelect<TReturn>(
    query: Query<'room_recaps', Schema, TReturn>
  ): Query<'room_recaps', Schema, TReturn> {
    return query
      .whereExists('room', (room) =>
        room
          .whereExists('project', (project) =>
            project.where('workspaceId', '=', this.ctx.workspaceId)
          )
          .whereExists('members', (m) =>
            m.where('userId', this.ctx.userID).where('status', RoomMemberStatus.APPROVED)
          )
      )
      .where(({ or, cmp, exists }) =>
        or(
          cmp('status', RoomRecapStatus.APPROVED),
          exists('room', (room) =>
            room.whereExists('members', (m) =>
              m
                .where('userId', this.ctx.userID)
                .where('status', RoomMemberStatus.APPROVED)
                .where('role', RoomRole.OWNER)
            )
          )
        )
      );
  }
}
