import { ChannelAddUserPolicy, ChannelRole, ChannelScopeType, UserStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { AppError } from '@/middleware/errorHandler';

const channelParticipantRepository = new ChannelParticipantRepository();

export interface ChannelParticipantTarget {
  userId: string;
  role: ChannelRole;
}

export interface AddChannelParticipantsParams {
  channelId: string;
  actorId: string;
  actorWorkspaceRole?: string;
  workspaceId: string;
  targets: ChannelParticipantTarget[];
}

export interface AddedChannelParticipant {
  userId: string;
  userName: string;
  participantId: string;
}

export interface AddChannelParticipantsResult {
  added: AddedChannelParticipant[];
  updated: ChannelParticipantTarget[];
  alreadyMembers: string[];
}

/**
 * Adds users to an existing channel on behalf of `actorId` with the role given for each, and sets the
 * role of any who are already in it.
 * Every target must be an active, non-guest user of the channel's own workspace, so no
 * cross-workspace participant can ever be created through this path.
 * All checks run before the first write, so a refused call changes nothing.
 */
export async function addChannelParticipants(
  params: AddChannelParticipantsParams
): Promise<AddChannelParticipantsResult> {
  const { channelId, actorId, actorWorkspaceRole, workspaceId } = params;
  const roleOf = new Map<string, ChannelRole>();
  for (const { userId, role } of params.targets) {
    // A user named twice keeps the higher role.
    if (roleOf.get(userId) !== ChannelRole.ADMIN) roleOf.set(userId, role);
  }
  const userIds = [...roleOf.keys()];

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
      createdBy: true,
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
  // The creator counts as an admin, as in the in-app role change.
  const actorIsAdmin = actor.role === ChannelRole.ADMIN || channel.createdBy === actorId;
  // channel_stats holds the policy the channel settings edit; channels.addUserPolicy is never updated after create.
  const policy = channel.channelStats?.addUserPolicy ?? ChannelAddUserPolicy.EVERYONE;
  if (policy === ChannelAddUserPolicy.ADMINS_ONLY && !actorIsAdmin) {
    throw new AppError('Only admins can add users to this channel', 403);
  }
  if ([...roleOf.values()].includes(ChannelRole.ADMIN) && !actorIsAdmin) {
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
    select: { userId: true, role: true },
  });
  const existingRole = new Map(existing.map((participant) => [participant.userId, participant.role]));
  const toAdd = userIds.filter((id) => !existingRole.has(id));
  const toUpdate = userIds.filter((id) => existingRole.has(id) && existingRole.get(id) !== roleOf.get(id));
  const unchanged = userIds.filter((id) => existingRole.has(id) && existingRole.get(id) === roleOf.get(id));

  // Same rules as the in-app role change: admins or the creator only, never your own role or the creator's.
  if (toUpdate.length > 0) {
    if (!actorIsAdmin) {
      throw new AppError('Only channel admins can update participant roles', 403);
    }
    if (toUpdate.includes(actorId)) {
      throw new AppError('Cannot update your own role', 400);
    }
    if (channel.createdBy && toUpdate.includes(channel.createdBy)) {
      throw new AppError("Cannot change the channel creator's role", 400);
    }
  }

  const added: AddedChannelParticipant[] = [];
  for (const role of [ChannelRole.ADMIN, ChannelRole.MEMBER]) {
    const ids = toAdd.filter((id) => roleOf.get(id) === role);
    if (ids.length === 0) continue;
    await channelParticipantRepository.addParticipantsBatch(channelId, ids, role);
    const created = await db.channelParticipant.findMany({
      where: { channelId, userId: { in: ids } },
      select: { id: true, userId: true },
    });
    for (const participant of created) {
      const user = byId.get(participant.userId)!;
      added.push({
        userId: participant.userId,
        userName: user.displayName || user.name,
        participantId: participant.id,
      });
    }
  }

  for (const userId of toUpdate) {
    await channelParticipantRepository.updateParticipantRole(channelId, userId, roleOf.get(userId)!);
  }

  return {
    added,
    updated: toUpdate.map((userId) => ({ userId, role: roleOf.get(userId)! })),
    alreadyMembers: unchanged,
  };
}
