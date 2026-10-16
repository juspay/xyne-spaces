import { ChannelAddUserPolicy, ChannelRole, ChannelScopeType, UserStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { AppError } from '@/middleware/errorHandler';

const channelParticipantRepository = new ChannelParticipantRepository();

export interface AddChannelParticipantsParams {
  channelId: string;
  actorId: string;
  actorWorkspaceRole?: string;
  workspaceId: string;
  userIds: string[];
  role: ChannelRole;
}

export interface AddedChannelParticipant {
  userId: string;
  userName: string;
  participantId: string;
}

export interface AddChannelParticipantsResult {
  added: AddedChannelParticipant[];
  alreadyMembers: string[];
}

/**
 * Adds users to an existing channel on behalf of `actorId`.
 * Every target must be an active, non-guest user of the channel's own workspace, so no
 * cross-workspace participant can ever be created through this path.
 */
export async function addChannelParticipants(
  params: AddChannelParticipantsParams
): Promise<AddChannelParticipantsResult> {
  const { channelId, actorId, actorWorkspaceRole, workspaceId, role } = params;
  const userIds = [...new Set(params.userIds)];

  if (actorWorkspaceRole === 'GUEST') {
    throw new AppError('Guests cannot add participants', 403);
  }

  // Tenant comes from the verified session; a channel in another workspace is reported as missing.
  const channel = await db.channel.findFirst({
    where: { id: channelId, workspaceId },
    select: {
      id: true,
      workspaceId: true,
      scopeType: true,
      isArchived: true,
      channelStats: { select: { addUserPolicy: true } },
    },
  });
  if (!channel) {
    throw new AppError('Channel not found', 404);
  }
  if (channel.scopeType !== ChannelScopeType.DEFAULT) {
    throw new AppError('Participants can only be added to regular channels', 400);
  }
  if (channel.isArchived) {
    throw new AppError('Cannot add participants to an archived channel', 400);
  }

  const actor = await db.channelParticipant.findFirst({
    where: { channelId, userId: actorId, workspaceId },
    select: { role: true },
  });
  if (!actor) {
    throw new AppError('You are not allowed to add participants to this channel', 403);
  }
  const actorIsAdmin = actor.role === ChannelRole.ADMIN;
  // channel_stats holds the policy the channel settings edit; channels.addUserPolicy is never updated after create.
  const policy = channel.channelStats?.addUserPolicy ?? ChannelAddUserPolicy.EVERYONE;
  if (policy === ChannelAddUserPolicy.ADMINS_ONLY && !actorIsAdmin) {
    throw new AppError('Only admins can add users to this channel', 403);
  }
  if (role === ChannelRole.ADMIN && !actorIsAdmin) {
    throw new AppError('Only channel admins can add admins', 403);
  }

  const users = await db.user.findMany({
    where: { id: { in: userIds }, workspaceId: channel.workspaceId },
    select: { id: true, name: true, displayName: true, role: true, status: true, leftAt: true },
  });
  const byId = new Map(users.map((user) => [user.id, user]));
  const unknown = userIds.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new AppError(`Users not found in this workspace: ${unknown.join(', ')}`, 400);
  }
  const ineligible = users.filter(
    (user) => user.status !== UserStatus.ACTIVE || user.leftAt !== null || user.role === 'GUEST'
  );
  if (ineligible.length > 0) {
    throw new AppError(
      `Users cannot be added (inactive or guest): ${ineligible.map((user) => user.id).join(', ')}`,
      400
    );
  }

  const existing = await db.channelParticipant.findMany({
    where: { channelId, userId: { in: userIds } },
    select: { userId: true },
  });
  const existingIds = new Set(existing.map((participant) => participant.userId));
  const toAdd = userIds.filter((id) => !existingIds.has(id));
  if (toAdd.length === 0) {
    return { added: [], alreadyMembers: [...existingIds] };
  }

  await channelParticipantRepository.addParticipantsBatch(channelId, toAdd, role);

  const created = await db.channelParticipant.findMany({
    where: { channelId, userId: { in: toAdd } },
    select: { id: true, userId: true },
  });
  return {
    added: created.map((participant) => {
      const user = byId.get(participant.userId)!;
      return {
        userId: participant.userId,
        userName: user.displayName || user.name,
        participantId: participant.id,
      };
    }),
    alreadyMembers: [...existingIds],
  };
}
