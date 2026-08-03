import type { Transaction } from '@rocicorp/zero';
import { ChannelVisibility, RoomMemberStatus, RoomRole, Schema } from '@xyne/shared';
import type { QueryContext } from '../core/types';
import { MutationACLError } from '../core/types';
import { hasProjectAdminAccess, isProjectParticipant } from '../core/admin-access';
import { zql } from '../../queries';

type RoomRow = NonNullable<Awaited<ReturnType<typeof getRoomInWorkspace>>>;

export async function getRoomInWorkspace(
  roomId: string,
  ctx: QueryContext,
  tx: Transaction<Schema>,
  tableName: string
) {
  const room = await tx.run(zql.rooms.where('id', '=', roomId).one());
  if (!room) {
    throw new MutationACLError('Room mutation failed: room does not exist', tableName);
  }
  const project = await tx.run(zql.projects.where('id', '=', room.projectId).one());
  if (!project || project.workspaceId !== ctx.workspaceId) {
    throw new MutationACLError('Room mutation failed: room not found in this workspace', tableName);
  }
  return room;
}

export async function assertProjectWritable(
  projectId: string,
  ctx: QueryContext,
  tx: Transaction<Schema>,
  tableName: string
): Promise<void> {
  const project = await tx.run(zql.projects.where('id', '=', projectId).one());
  if (!project) {
    throw new MutationACLError(
      'Room insert failed: the specified project does not exist',
      tableName
    );
  }
  if (project.workspaceId !== ctx.workspaceId) {
    throw new MutationACLError('Room insert failed: project workspace mismatch', tableName);
  }

  if (await hasProjectAdminAccess(ctx, tx)) return;

  if (!(await isProjectParticipant(ctx, tx, projectId))) {
    throw new MutationACLError(
      'Room insert failed: you must be a project participant to create rooms',
      tableName
    );
  }
}

/** A room is managed by its approved owners only - ownership lives in room_members, not on the room. */
export async function isRoomManager(
  room: RoomRow,
  ctx: QueryContext,
  tx: Transaction<Schema>
): Promise<boolean> {
  const owner = await tx.run(
    zql.room_members
      .where('roomId', '=', room.id)
      .where('userId', '=', ctx.userID)
      .where('role', '=', RoomRole.OWNER)
      .where('status', '=', RoomMemberStatus.APPROVED)
      .one()
  );
  return !!owner;
}

export async function requireRoomManager(
  room: RoomRow,
  ctx: QueryContext,
  tx: Transaction<Schema>,
  tableName: string
): Promise<void> {
  if (await isRoomManager(room, ctx, tx)) return;
  throw new MutationACLError(
    'Room mutation failed: only the room owner can do this',
    tableName
  );
}

export async function assertSourceAttachable(
  sourceId: string,
  ctx: QueryContext,
  tx: Transaction<Schema>,
  tableName: string
): Promise<void> {
  const fail = (reason: string): never => {
    throw new MutationACLError(`Room source insert failed: ${reason}`, tableName);
  };

  const channelInWorkspaceAndVisible = async (channelId: string): Promise<boolean> => {
    const channel = await tx.run(zql.channels.where('id', '=', channelId).one());
    if (!channel || channel.workspaceId !== ctx.workspaceId) return false;
    if (channel.visibility === ChannelVisibility.PUBLIC) return true;
    const participant = await tx.run(
      zql.channel_participants
        .where('channelId', '=', channelId)
        .where('userId', '=', ctx.userID)
        .one()
    );
    return !!participant;
  };

  if (!(await channelInWorkspaceAndVisible(sourceId))) {
    fail('channel does not exist in this workspace or you cannot access it');
  }
}
