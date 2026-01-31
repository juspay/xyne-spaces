import { ActivityClassification, ActivityClassificationJobType, PrismaClient } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

export interface CreateActivityParams {
  id?: string;
  userId: string;
  actorAction: string;
  /** @deprecated Use messageId, reactionId, or callId instead. Still required for backward compatibility. */
  actionSource: string;
  /** @deprecated Use messageId, reactionId, or callId instead. Still required for backward compatibility. */
  actionSourceId: string;
  // New FK columns
  messageId?: string;
  reactionId?: string;
  callId?: string;
  channelId?: string;
  classification?: ActivityClassification;
  classificationConfidence?: number | null;
  classificationJobType?: ActivityClassificationJobType | null;
}

export class ActivityService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a single activity
   */
  async createActivity(params: CreateActivityParams): Promise<void> {
    logger.info('[ActivityService] Creating activity', {
      activityId: params.id,
      userId: params.userId,
      actorAction: params.actorAction,
      actionSource: params.actionSource,
      actionSourceId: params.actionSourceId,
      messageId: params.messageId,
      reactionId: params.reactionId,
      callId: params.callId,
      channelId: params.channelId,
      classification: params.classification,
    });
    await this.prisma.activity.create({
      data: {
        ...(params.id ? { id: params.id } : {}),
        userId: params.userId,
        actorAction: params.actorAction,
        actionSource: params.actionSource,
        actionSourceId: params.actionSourceId,
        ...(params.messageId ? { messageId: params.messageId } : {}),
        ...(params.reactionId ? { reactionId: params.reactionId } : {}),
        ...(params.callId ? { callId: params.callId } : {}),
        channelId: params.channelId,
        ...(params.classification ? { classification: params.classification } : {}),
        ...(params.classificationJobType !== undefined
          ? { classificationJobType: params.classificationJobType }
          : {}),
        ...(params.classificationConfidence !== undefined
          ? { classificationConfidence: params.classificationConfidence }
          : {}),
        isRead: params.actionSource === 'reaction',
      },
    });
    logger.info('[ActivityService] Activity persisted', {
      activityId: params.id,
      userId: params.userId,
    });
  }

  /**
   * Create multiple activities in batch (for multiple users)
   */
  async createActivities(activities: CreateActivityParams[]): Promise<void> {
    if (activities.length === 0) return;

    logger.info('[ActivityService] Creating activities batch', {
      count: activities.length,
      activityIds: activities.map(activity => activity.id).filter(Boolean),
      actorActions: [...new Set(activities.map(activity => activity.actorAction))],
      actionSources: [...new Set(activities.map(activity => activity.actionSource))],
      channelIds: [
        ...new Set(
          activities
            .map(activity => activity.channelId)
            .filter((channelId): channelId is string => Boolean(channelId))
        ),
      ],
      classifications: [
        ...new Set(activities.map(activity => activity.classification).filter(Boolean)),
      ],
    });

    await this.prisma.activity.createMany({
      data: activities.map(a => ({
        ...(a.id ? { id: a.id } : {}),
        userId: a.userId,
        actorAction: a.actorAction,
        actionSource: a.actionSource,
        actionSourceId: a.actionSourceId,
        ...(a.messageId ? { messageId: a.messageId } : {}),
        ...(a.reactionId ? { reactionId: a.reactionId } : {}),
        ...(a.callId ? { callId: a.callId } : {}),
        channelId: a.channelId,
        ...(a.classification ? { classification: a.classification } : {}),
        ...(a.classificationJobType !== undefined
          ? { classificationJobType: a.classificationJobType }
          : {}),
        ...(a.classificationConfidence !== undefined
          ? { classificationConfidence: a.classificationConfidence }
          : {}),
        isRead: a.actionSource === 'reaction',
      })),
    });

    logger.info('[ActivityService] Activities batch persisted', {
      count: activities.length,
    });
  }

  async deleteActivitiesBySource(actionSource: string, actionSourceId: string): Promise<void> {
    await this.prisma.activity.deleteMany({
      where: {
        actionSource,
        actionSourceId,
      },
    });
  }

  async deleteActivitiesBySourceIds(actionSource: string, actionSourceIds: string[]): Promise<void> {
    if (actionSourceIds.length === 0) return;

    await this.prisma.activity.deleteMany({
      where: {
        actionSource,
        actionSourceId: { in: actionSourceIds },
      },
    });
  }
}

// Singleton instance
export const activityService = new ActivityService(db);
