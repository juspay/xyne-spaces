import { Request } from 'express';
import { Channel } from '@prisma/client';
import { ChannelRole, UserStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { checkChannelMembership } from '@/database/acl/tables/channel-access-helper';

export type ChannelAccessGranted = {
  ok: true;
  userId: string;
  workspaceId: string;
  channel: Channel;
};

export type ChannelAccessDenied = {
  ok: false;
  status: number;
  error: string;
};

export type ChannelAccessResult = ChannelAccessGranted | ChannelAccessDenied;

const channelParticipantRepo = new ChannelParticipantRepository();

/**
 * Desk endpoints require unconditional channel participation, which is stricter than
 * ChannelsACL (PUBLIC-or-participant). Callers that also gate on desk ownership pass the
 * granted result to assertDeskOwner.
 */
export async function assertChannelMembership(
  req: Request,
  channelId: string,
): Promise<ChannelAccessResult> {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;

  if (!userId || !workspaceId) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  const access = await checkChannelMembership(db, channelId, userId, workspaceId);
  if (!access.ok) {
    return access.reason === 'not_found'
      ? { ok: false, status: 404, error: 'Channel not found' }
      : { ok: false, status: 403, error: 'Not a member of this channel' };
  }

  return { ok: true, userId, workspaceId, channel: access.channel };
}

export function assertDeskOwner(
  access: ChannelAccessGranted,
  preferenceOwnerUserId: string | null | undefined,
  denyMessage: string,
): ChannelAccessResult {
  if (access.channel.createdBy === access.userId || preferenceOwnerUserId === access.userId) {
    return access;
  }
  return { ok: false, status: 403, error: denyMessage };
}

/**
 * Everyone allowed to manage a desk's integrations: the channel creator, the desk owner and
 * channel admins — the same three that the desk and social-media connect routes accept — minus
 * deactivated users.
 */
export async function listDeskManagerUserIds(channelId: string): Promise<string[]> {
  const [channel, preference, admins] = await Promise.all([
    db.channel.findUnique({ where: { id: channelId }, select: { createdBy: true } }),
    db.emailChannelPreference.findUnique({ where: { channelId }, select: { ownerUserId: true } }),
    db.channelParticipant.findMany({
      where: { channelId, role: ChannelRole.ADMIN },
      select: { userId: true },
    }),
  ]);
  const userIds = [channel?.createdBy, preference?.ownerUserId, ...admins.map((a) => a.userId)];
  const active = await db.user.findMany({
    where: { id: { in: userIds.filter((id): id is string => Boolean(id)) }, status: UserStatus.ACTIVE },
    select: { id: true },
  });
  return active.map((user) => user.id);
}

/**
 * Desk-insights ACL shared by metrics, the topics feed and desk reports so the
 * surfaces cannot drift: desk owner OR channel admin — NOT channel.createdBy.
 */
export async function isDeskOwnerOrChannelAdmin(
  channelId: string,
  userId: string | undefined,
  preferenceOwnerUserId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  if (preferenceOwnerUserId && preferenceOwnerUserId === userId) return true;
  const participant = await channelParticipantRepo.findParticipant(channelId, userId);
  return participant?.role === ChannelRole.ADMIN;
}
