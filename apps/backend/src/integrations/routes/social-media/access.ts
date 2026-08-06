import type { Response } from 'express';
import { ChannelType } from '@xyne/shared';
import { db } from '@/database/client';

export async function canAccessSocialMediaChannel(
  channelId: string,
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const channel = await db.channel.findFirst({
    where: {
      id: channelId,
      workspaceId,
      type: ChannelType.SOCIAL_MEDIA,
      participants: { some: { userId } },
    },
    select: { id: true },
  });
  return Boolean(channel);
}

export async function authorizeSocialMediaManager(
  channelId: string,
  userId: string,
  workspaceId: string,
  res: Response
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

  res.status(403).json({ error: 'Only the desk owner can manage this integration' });
  return false;
}
