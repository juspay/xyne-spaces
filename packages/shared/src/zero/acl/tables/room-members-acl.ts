import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { RoomMemberStatus } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class RoomMembersACL extends BaseQueryACL<'room_members'> {
  constructor(ctx: Context) {
    super(ctx, 'room_members');
  }

  canSelect<TReturn>(query: Query<'room_members', Schema, TReturn>): Query<'room_members', Schema, TReturn> {
    return query
      .whereExists('room', (room) =>
        room.whereExists('project', (project) =>
          project.where('workspaceId', '=', this.ctx.workspaceId)
        )
      )
      .where(({ or, cmp, exists }) =>
        or(
          cmp('userId', '=', this.ctx.userID),
          exists('room', (room) =>
            room.whereExists('members', (m) =>
              m.where('userId', this.ctx.userID).where('status', RoomMemberStatus.APPROVED)
            )
          )
        )
      );
  }
}
