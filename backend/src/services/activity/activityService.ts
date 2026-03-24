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
  ticketId?: string;
  channelId?: string;
  pullRequestId?: string;
  canvasId?: string;
  blockId?: string;
  actorId: string;
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
      ticketId: params.ticketId,
      channelId: params.channelId,
      actorId: params.actorId,
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
        ...(params.ticketId ? { ticketId: params.ticketId } : {}),
        ...(params.pullRequestId ? { pullRequestId: params.pullRequestId } : {}),
        ...(params.canvasId ? { canvasId: params.canvasId } : {}),
        ...(params.blockId ? { blockId: params.blockId } : {}),
        channelId: params.channelId,
        actorId: params.actorId,
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
        ...(a.ticketId ? { ticketId: a.ticketId } : {}),
        ...(a.canvasId ? { canvasId: a.canvasId } : {}),
        ...(a.blockId ? { blockId: a.blockId } : {}),
        channelId: a.channelId,
        actorId: a.actorId,
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


  /**
   * Upsert a reaction activity (V2)
   * For batched reaction activities (one activity per message)
   */
  async upsertReactionActivityV2(params: {
    messageId: string;
    channelId: string;
    actorId: string;
    messageAuthorId: string;
  }): Promise<'created' | 'updated'> {
    const { messageId, channelId, actorId, messageAuthorId } = params;

    const existingActivity = await this.prisma.activity.findFirst({
      where: {
        userId: messageAuthorId,
        messageId: messageId,
        actorAction: 'added_v2',
        actionSource: 'message',
      },
    });

    if (existingActivity) {
      await this.prisma.activity.update({
        where: { id: existingActivity.id },
        data: {
          actorId: actorId,
          isRead: false,
        },
      });

      logger.info('[ActivityService] Updated existing reaction activity (v2)', {
        activityId: existingActivity.id,
        messageId,
        newActorId: actorId,
      });

      return 'updated';
    }

    await this.prisma.activity.create({
      data: {
        userId: messageAuthorId,
        actorAction: 'added_v2',
        actionSource: 'message',
        actionSourceId: messageId,
        messageId: messageId,
        channelId: channelId,
        actorId: actorId,
        isRead: false,
        classification: ActivityClassification.FYI,
      },
    });

    logger.info('[ActivityService] Created new reaction activity (v2)', {
      messageId,
      actorId,
    });

    return 'created';
  }


  async deleteReactionActivityV2(messageId: string, messageAuthorId: string): Promise<void> {
    await this.prisma.activity.deleteMany({
      where: {
        userId: messageAuthorId,
        messageId: messageId,
        actorAction: 'added_v2',
        actionSource: 'message',
      },
    });

    logger.info('[ActivityService] Deleted reaction activity (v2)', { messageId });
  }


  async updateReactionActivityActorIdOnlyV2(params: {       //using only in case of reaction deletion where updateAt is not to be updated
    messageId: string;
    messageAuthorId: string;
    actorId: string;
  }): Promise<void> {
    const { messageId, messageAuthorId, actorId } = params;

    await this.prisma.$executeRaw`
      UPDATE "activities"
      SET "actorId" = ${actorId}
      WHERE "userId" = ${messageAuthorId}
        AND "messageId" = ${messageId}
        AND "actorAction" = 'added_v2'
        AND "actionSource" = 'message'
    `;
  }


  /**
   * Upsert a reply activity (V2)
   * For batched thread reply activities (one activity per parent message)
   */
  async upsertReplyActivityV2(params: {
    conversationId: string;
    parentMessageId: string;
    channelId: string;
    actorId: string;
    recipientUserId: string;
    latestReplyMessageId: string;
  }): Promise<'created' | 'updated'> {
    const {
      conversationId,
      channelId,
      actorId,
      recipientUserId,
      latestReplyMessageId,
    } = params;

    const existingActivity = await this.prisma.activity.findFirst({
      where: {
        userId: recipientUserId,
        conversationId,
        actorAction: 'replied_v2',
        actionSource: 'message',
      },
    });

    if (existingActivity) {
      await this.prisma.activity.update({
        where: { id: existingActivity.id },
        data: {
          actorId: actorId,
          isRead: false,
          messageId: latestReplyMessageId,
          actionSourceId: latestReplyMessageId,
        },
      });

      logger.info('[ActivityService] Updated existing reply activity (v2)', {
        activityId: existingActivity.id,
        conversationId,
        newActorId: actorId,
      });

      return 'updated';
    }

    await this.prisma.activity.create({
      data: {
        userId: recipientUserId,
        actorAction: 'replied_v2',
        actionSource: 'message',
        actionSourceId: latestReplyMessageId,
        messageId: latestReplyMessageId,
        conversationId,
        channelId: channelId,
        actorId: actorId,
        isRead: false,
        classification: ActivityClassification.FYI,
      },
    });

    logger.info('[ActivityService] Created new reply activity (v2)', {
      conversationId,
      actorId,
    });

    return 'created';
  }


  async deleteReplyActivitiesV2(conversationId: string, recipientUserIds: string[]): Promise<void> {
    if (recipientUserIds.length === 0) return;
    await this.prisma.activity.deleteMany({
      where: {
        userId: { in: recipientUserIds },
        conversationId,
        actorAction: 'replied_v2',
        actionSource: 'message',
      },
    });

    logger.info('[ActivityService] Deleted reply activity (v2)', { conversationId });
  }


  async updateReplyActivitiesMetadataV2(params: {
    conversationId: string;
    recipientUserIds: string[];
    actorId: string;
    latestReplyMessageId: string;
  }): Promise<void> {
    const { conversationId, recipientUserIds, actorId, latestReplyMessageId } = params;

    if (recipientUserIds.length === 0) return;

    await this.prisma.activity.updateMany({
      where: {
        userId: { in: recipientUserIds },
        conversationId,
        actorAction: 'replied_v2',
        actionSource: 'message',
      },
      data: {
        actorId,
        messageId: latestReplyMessageId,
        actionSourceId: latestReplyMessageId,
      },
    });
  }
}

// Singleton instance
export const activityService = new ActivityService(db);
