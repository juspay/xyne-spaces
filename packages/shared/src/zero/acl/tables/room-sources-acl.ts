import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { RoomMemberStatus } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class RoomSourcesACL extends BaseQueryACL<'room_sources'> {
  constructor(ctx: Context) {
    super(ctx, 'room_sources');
  }

  canSelect<TReturn>(query: Query<'room_sources', Schema, TReturn>): Query<'room_sources', Schema, TReturn> {
    return query.whereExists('room', (room) =>
      room
        .whereExists('project', (project) => project.where('workspaceId', '=', this.ctx.workspaceId))
        .whereExists('members', (m) =>
          m.where('userId', this.ctx.userID).where('status', RoomMemberStatus.APPROVED)
        )
    );
  }
}
