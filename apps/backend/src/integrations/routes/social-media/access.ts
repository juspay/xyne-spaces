import type { Response } from 'express';
import { ChannelRole, ChannelType, ChannelVisibility } from '@xyne/shared';
import { db } from '@/database/client';

export async function canAccessSocialMediaChannel(
  channelId: string,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const channel = await db.channel.findFirst({
    where: {
      id: channelId,
      workspaceId,
      type: ChannelType.SOCIAL_MEDIA,
      OR: [{ visibility: ChannelVisibility.PUBLIC }, { participants: { some: { userId } } }],
    },
    select: { id: true },
  });
  return Boolean(channel);
}

export async function authorizeSocialMediaManager(
  channelId: string,
  userId: string,
  workspaceId: string,
  res: Response,
): Promise<boolean> {
  const channel = await db.channel.findFirst({
    where: { id: channelId, workspaceId, type: ChannelType.SOCIAL_MEDIA },
    select: { createdBy: true },
  });
  if (!channel) {
    res.status(404).json({ error: 'Social media desk not found' });
    return false;
  }
  if (channel.createdBy === userId) return true;

  const preference = await db.emailChannelPreference.findUnique({
    where: { channelId },
    select: { ownerUserId: true },
  });
  if (preference?.ownerUserId === userId) return true;

  const participant = await db.channelParticipant.findUnique({
    where: { channelId_userId: { channelId, userId } },
    select: { role: true },
  });
  if (participant?.role === ChannelRole.ADMIN) return true;

  res
    .status(403)
    .json({ error: 'Only the desk owner or a channel admin can manage this integration' });
  return false;
}
