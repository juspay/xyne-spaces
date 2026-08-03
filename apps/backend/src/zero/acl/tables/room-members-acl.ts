import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { RoomMemberStatus, RoomRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
import { getRoomInWorkspace, isRoomManager, requireRoomManager } from './room-acl-helpers';

function isOwnerBootstrap(
  args: InsertValue<TableSchema<'room_members'>>,
  userId: string
): boolean {
  return (
    args.userId === userId &&
    args.role === RoomRole.OWNER &&
    args.status === RoomMemberStatus.APPROVED
  );
}

function isSelfAccessRequest(
  args: InsertValue<TableSchema<'room_members'>>,
  userId: string
): boolean {
  return (
    args.userId === userId &&
    (args.status ?? RoomMemberStatus.PENDING) === RoomMemberStatus.PENDING &&
    (args.role ?? RoomRole.MEMBER) === RoomRole.MEMBER
  );
}

export class RoomMembersACL extends BaseACL<'room_members'> {
  async canInsert(
    args: InsertValue<TableSchema<'room_members'>>,
    tx: Transaction<Schema>
  ): Promise<void> {
    const room = await getRoomInWorkspace(args.roomId, this.ctx, tx, 'room_members');

    const existing = await tx.run(
      zql.room_members.where('roomId', '=', args.roomId).where('userId', '=', args.userId).one()
    );
    if (existing) {
      throw new MutationACLError(
        'Room member insert failed: user is already a member or has a pending request',
        'room_members'
      );
    }

    if (await isRoomManager(room, this.ctx, tx)) return;

    // room.create writes its own owner row, and ownership now lives only in room_members,
    // so a room's first member has no existing owner to authorise it. canDelete keeps the
    // last owner in place, which is what keeps this branch limited to room creation.
    if (isOwnerBootstrap(args, this.ctx.userID)) {
      const anyMember = await tx.run(
        zql.room_members.where('roomId', '=', args.roomId).one()
      );
      if (!anyMember) return;
    }

    if (isSelfAccessRequest(args, this.ctx.userID)) return;

    throw new MutationACLError(
      'Room member insert failed: only the room owner can add members; others can only request access for themselves',
      'room_members'
    );
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'room_members'>>,
    tx: Transaction<Schema>
  ): Promise<void> {
    const member = await tx.run(zql.room_members.where('id', '=', args.id).one());
    if (!member) {
      throw new MutationACLError(
        'Room member update failed: member record does not exist',
        'room_members'
      );
    }
    if (args.roomId !== undefined && args.roomId !== member.roomId) {
      throw new MutationACLError(
        'Room member update failed: roomId cannot be changed',
        'room_members'
      );
    }
    if (args.userId !== undefined && args.userId !== member.userId) {
      throw new MutationACLError(
        'Room member update failed: userId cannot be changed',
        'room_members'
      );
    }
    const room = await getRoomInWorkspace(member.roomId, this.ctx, tx, 'room_members');
    await requireRoomManager(room, this.ctx, tx, 'room_members');
  }

  async canDelete(
    args: DeleteID<TableSchema<'room_members'>>,
    tx: Transaction<Schema>
  ): Promise<void> {
    const member = await tx.run(zql.room_members.where('id', '=', args.id).one());
    if (!member) {
      throw new MutationACLError(
        'Room member delete failed: member record does not exist',
        'room_members'
      );
    }
    const room = await getRoomInWorkspace(member.roomId, this.ctx, tx, 'room_members');

    // Rooms are never hard-deleted, so a room that loses its last owner can never be managed
    // or curated again - there is no createdBy to fall back on.
    if (member.role === RoomRole.OWNER && member.status === RoomMemberStatus.APPROVED) {
      const otherOwner = await tx.run(
        zql.room_members
          .where('roomId', '=', member.roomId)
          .where('role', '=', RoomRole.OWNER)
          .where('status', '=', RoomMemberStatus.APPROVED)
          .where('id', '!=', member.id)
          .one()
      );
      if (!otherOwner) {
        throw new MutationACLError(
          'Room member delete failed: a room must keep at least one owner',
          'room_members'
        );
      }
    }

    if (member.userId === this.ctx.userID) return;

    await requireRoomManager(room, this.ctx, tx, 'room_members');
  }
}
