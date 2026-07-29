import { activityService } from '@/services/activity/activityService';
import { db } from '@/database/client';
import { v4 as uuidv4 } from 'uuid';
import { ActivityClassification } from '@prisma/client';
import { logger } from '@/utils/logger';

/**
 * Create activity when a channel is created
 * @param channelId - ID of the channel
 * @param creatorUserId - User who created the channel (excluded from activities)
 */
export async function createChannelCreatedActivity(
  channelId: string,
  creatorUserId: string
): Promise<void> {
  logger.info('[ActivityUtils] Creating channel created activities', {
    channelId,
    creatorUserId,
  });
  // Fetch all channel participants except the creator
  const participants = await db.channelParticipant.findMany({
    where: {
      channelId,
      userId: { not: creatorUserId },
    },
    select: { userId: true },
  });

  const memberIds = participants.map(p => p.userId);
  if (memberIds.length === 0) return;

  const activities = memberIds.map(userId => ({
    id: uuidv4(),
    userId,
    actorId: creatorUserId,
    actorAction: 'created' as const,
    actionSource: 'channel' as const,
    actionSourceId: channelId,
    channelId,
    classification: ActivityClassification.FYI,
  }));

  await activityService.createActivities(activities);
}

/**
 * Create activity when channel visibility changes
 * @param channelId - ID of the channel
 * @param changerUserId - User who changed the visibility (excluded from activities)
 */
export async function createChannelVisibilityChangedActivity(
  channelId: string,
  changerUserId: string
): Promise<void> { 
  // Fetch all channel participants except the user who made the change
  const participants = await db.channelParticipant.findMany({
    where: {
      channelId,
      userId: { not: changerUserId },
    },
    select: { userId: true },
  });

  const memberIds = participants.map(p => p.userId);
  if (memberIds.length === 0) return;

  const activities = memberIds.map(userId => ({
    id: uuidv4(),
    userId,
    actorId: changerUserId,
    actorAction: 'visibility_changed' as const,
    actionSource: 'channel' as const,
    actionSourceId: channelId,
    channelId,
    classification: ActivityClassification.FYI,
  }));

  await activityService.createActivities(activities);
}

/**
 * Create activity when channel is archived
 * @param channelId - ID of the channel
 * @param archiverUserId - User who archived the channel (excluded from activities)
 */
export async function createChannelArchivedActivity(
  channelId: string,
  archiverUserId: string
): Promise<void> {
  // Fetch all channel participants except the user who archived
  const participants = await db.channelParticipant.findMany({
    where: {
      channelId,
      userId: { not: archiverUserId },
    },
    select: { userId: true },
  });

  const memberIds = participants.map(p => p.userId);
  if (memberIds.length === 0) return;

  const activities = memberIds.map(userId => ({
    id: uuidv4(),
    userId,
    actorId: archiverUserId,
    actorAction: 'archived' as const,
    actionSource: 'channel' as const,
    actionSourceId: channelId,
    channelId,
    classification: ActivityClassification.FYI,
  }));

  await activityService.createActivities(activities);
}
