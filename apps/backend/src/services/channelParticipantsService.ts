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
  updateRoles?: boolean;
}

export interface AddedChannelParticipant {
  userId: string;
  userName: string;
  participantId: string;
}

export interface AddChannelParticipantsResult {
  added: AddedChannelParticipant[];
  updated: Array<{ userId: string; userName: string; oldRole: string; role: ChannelRole }>;
  alreadyMembers: string[];
}

/**
 * Adds users to an existing channel on behalf of `actorId` with the role given for each. People already
 * in it keep their role, unless `updateRoles` is set, which sets their role to the one given.
 * Every target must be an active, non-guest user of the channel's own workspace, so no
 * cross-workspace participant can ever be created through this path.
 * Every validation runs before the first write, and the writes commit in one transaction, so a refused
 * or failed call changes nothing. Announcements are the caller's job and run after the commit.
 */
export async function addChannelParticipants(
  params: AddChannelParticipantsParams
): Promise<AddChannelParticipantsResult> {
  const { channelId, actorId, actorWorkspaceRole, workspaceId, updateRoles = false } = params;
  const roleOf = new Map<string, ChannelRole>();
  for (const { userId, role } of params.targets) {
    // A user can have a single role; the same user with two different ones is a bad request, not a guess.
    if (roleOf.has(userId) && roleOf.get(userId) !== role) {
      throw new AppError(`A user can have a single role, but ${userId} was given both ADMIN and MEMBER`, 400);
    }
    roleOf.set(userId, role);
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
  // People already in the channel keep their role unless the caller asked for roles to be updated.
  const toUpdate = updateRoles
    ? userIds.filter((id) => existingRole.has(id) && existingRole.get(id) !== roleOf.get(id))
    : [];

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

  // One transaction for every insert and role change. What comes back is what it really did: a user a
  // concurrent call got in first, or whose role was already changed, is not reported (or announced) twice.
  const changes = await channelParticipantRepository.applyParticipantChanges(
    channelId,
    toAdd.map((userId) => ({ userId, role: roleOf.get(userId)! })),
    toUpdate.map((userId) => ({ userId, role: roleOf.get(userId)! })),
  );

  const nameOf = (userId: string): string => {
    const user = byId.get(userId)!;
    return user.displayName || user.name;
  };
  const added = changes.inserted.map((participant) => ({
    userId: participant.userId,
    userName: nameOf(participant.userId),
    participantId: participant.id,
  }));
  const updated = changes.updated.map((change) => ({ ...change, userName: nameOf(change.userId) }));
  const touched = new Set([...added.map((a) => a.userId), ...updated.map((u) => u.userId)]);

  return { added, updated, alreadyMembers: userIds.filter((id) => !touched.has(id)) };
}
