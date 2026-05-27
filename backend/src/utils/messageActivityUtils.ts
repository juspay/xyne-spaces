import { activityService } from '@/services/activity/activityService';
import { db } from '@/database/client';
import { v4 as uuidv4 } from 'uuid';
import { ActivityClassification } from '@prisma/client';
import { logger } from '@/utils/logger';

type ActivityClassificationConfig = {
  enabled: boolean;
};

const ACTIVITY_CLASSIFICATION_METADATA_PATH = ['activityClassification', 'enabled'] as const;

export const getActivityClassificationConfig = async (): Promise<ActivityClassificationConfig> => {
  try {
    logger.info('[ActionableFYI] Loading enabled users from user metadata');
    const enabledUser = await db.user.findFirst({
      where: {
        metadata: {
          path: [...ACTIVITY_CLASSIFICATION_METADATA_PATH],
          equals: true,
        },
      },
      select: { id: true },
    });

    const resolved = { enabled: Boolean(enabledUser) };
    logger.info('[ActionableFYI] Enabled users loaded', { enabled: resolved.enabled });
    return resolved;
  } catch (error) {
    logger.warn('[ActionableFYI] Failed to load config from database, using defaults', { error });
    return { enabled: false };
  }
};

export const isActivityClassificationUserEnabled = async (user: {
  id: string;
  email?: string | null;
}): Promise<boolean> => {
  if (!user?.id) return false;
  try {
    const enabled = await db.user.findFirst({
      where: {
        id: user.id,
        metadata: {
          path: [...ACTIVITY_CLASSIFICATION_METADATA_PATH],
          equals: true,
        },
      },
      select: { id: true },
    });

    if (enabled) {
      logger.info('[ActionableFYI] User enabled by metadata', { userId: user.id });
      return true;
    }

    logger.info('[ActionableFYI] User not enabled', { userId: user.id, email: user.email });
    return false;
  } catch (error) {
    logger.warn('[ActionableFYI] Failed to check user enablement', {
      userId: user.id,
      error,
    });
    return false;
  }
};

export const filterEnabledUserIds = async (userIds: string[]): Promise<string[]> => {
  const uniqueUserIds = [...new Set(userIds.map(id => id.trim()).filter(Boolean))];
  if (uniqueUserIds.length === 0) return [];

  try {
    const enabledUsers = await db.user.findMany({
      where: {
        id: { in: uniqueUserIds },
        metadata: {
          path: [...ACTIVITY_CLASSIFICATION_METADATA_PATH],
          equals: true,
        },
      },
      select: { id: true },
    });

    const enabledSet = new Set(enabledUsers.map(user => user.id.toLowerCase()));
    const enabledUserIds = uniqueUserIds.filter(userId =>
      enabledSet.has(userId.toLowerCase())
    );

    logger.info('[ActionableFYI] Filtered enabled users', {
      inputCount: uniqueUserIds.length,
      enabledCount: enabledUserIds.length,
    });

    return enabledUserIds;
  } catch (error) {
    logger.warn('[ActionableFYI] Failed to filter enabled users', { error });
    return [];
  }
};

/**
 * Create activity when a user is mentioned in a message
 * @param mentionedUserId - User who was mentioned
 * @param messageId - ID of the message
 * @param senderUserId - User who sent the message (excluded if same as mentioned user)
 */

/**
 * Create activities for special mentions (@channel and @here)
 * @param mentionedUserIds - Array of user IDs who should receive activity
 * @param messageId - ID of the message
 * @param senderUserId - User who sent the message (excluded from activities)
 * @param channelId - ID of the channel where the mention occurred
 */
export async function createSpecialMentionActivities(
  mentionedUserIds: string[],
  messageId: string,
  senderUserId: string,
  channelId: string,
  options?: {
    classification?: ActivityClassification;
    enqueue?: boolean;
    isThreadActivity?: boolean;
  }
): Promise<void> {
  logger.info('[ActivityUtils] Creating special mention activities', {
    mentionedUserIds,
    messageId,
    senderUserId,
  });
  // Filter out sender from mentioned users
  const userIds = mentionedUserIds.filter(id => id !== senderUserId);
  if (userIds.length === 0) return;

  const activities = userIds.map(userId => ({
    id: uuidv4(),
    userId,
    actorId: senderUserId,
    actorAction: 'group_mention' as const,
    actionSource: 'message' as const,
    actionSourceId: messageId,
    messageId: messageId,
    channelId,
    isThreadActivity: options?.isThreadActivity,
    classification: options?.classification ?? ActivityClassification.PENDING,
  }));

  await activityService.createActivities(activities);
}

/**
 * Create activities for direct 1:1 DM messages (non-mention flow)
 * @param messageId - ID of the message
 * @param senderUserId - User who sent the message (excluded from activities)
 * @param channelId - ID of the DM channel
 */
export async function createDirectMessageActivities(
  messageId: string,
  senderUserId: string,
  channelId: string,
  isThreadActivity?: boolean
): Promise<void> {
  logger.info('[ActivityUtils] Creating direct message activities', {
    messageId,
    senderUserId,
    channelId,
  });

  const participants = await db.channelParticipant.findMany({
    where: { channelId },
    select: { userId: true },
  });

  const recipientIds = participants
    .map(p => p.userId)
    .filter(userId => userId && userId !== senderUserId);

  if (recipientIds.length === 0) return;

  const activities = recipientIds.map(userId => ({
    id: uuidv4(),
    userId,
    actorId: senderUserId,
    actorAction: 'direct_message' as const,
    actionSource: 'message' as const,
    actionSourceId: messageId,
    messageId: messageId,
    channelId,
    isThreadActivity,
    classification: ActivityClassification.PENDING,
  }));

  await activityService.createActivities(activities);
}

/**
 * Create activity when someone replies to a thread
 * @param conversationId - ID of the conversation (thread)
 * @param replyMessageId - ID of the reply message
 * @param mentionedUserIds - Array of user IDs who were mentioned (excluded from reply activities)
 * @param senderUserId - User who sent the reply
 * @param channelId - ID of the channel where the reply occurred
 */
