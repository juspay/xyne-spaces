import { PrismaClient } from '@prisma/client';
import { ActivityClassification, ActivityClassificationJobType, UserStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { currentWorkspaceId, withWorkspaceScope, runAsSystem } from '@/database/tenant/context';
import { logger } from '@/utils/logger';

export interface CreateActivityParams {
  id?: string;
  userId: string;
  workspaceId?: string;
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
  conversationId?: string;
  channelId?: string;
  pullRequestId?: string;
  canvasId?: string;
  blockId?: string;
  conversationSeenCutoffAt?: Date | null;
  isThreadActivity?: boolean;
  actorId: string;
  classification?: ActivityClassification;
  classificationConfidence?: number | null;
  classificationJobType?: ActivityClassificationJobType | null;
}

export class ActivityService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Resolve the workspaceId for an activity row (denormalized tenant key).
   * Prefers an explicitly-supplied workspaceId, then derives it from the
   * activity's channel, and finally falls back to the ambient tenant context.
   */
  private async resolveWorkspaceId(params: {
    workspaceId?: string;
    channelId?: string;
  }): Promise<string> {
    if (params.workspaceId) return params.workspaceId;
    if (params.channelId) {
      return repositories.channels.getWorkspaceId(params.channelId);
    }
    const ctxWorkspaceId = currentWorkspaceId();
    if (ctxWorkspaceId) return ctxWorkspaceId;
    throw new Error(
      '[ActivityService] workspaceId required: no explicit workspaceId, channelId, or tenant context',
    );
  }

  private getActivityMessageId(params: CreateActivityParams): string | null {
    return params.messageId ?? (params.actionSource === 'message' ? params.actionSourceId : null);
  }

  private async getConversationSeenCutoffAt(
    channelId: string,
    targetConversationCreatedAt: Date,
  ): Promise<Date | null> {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        channelId,
        createdAt: { lte: targetConversationCreatedAt },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { createdAt: true },
    });

    return conversations[conversations.length - 1]?.createdAt ?? null;
  }

  private async getConversationSeenCutoffAtForConversation(
    conversationId: string,
    fallbackChannelId?: string,
  ): Promise<Date | null> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { conversationId },
      select: {
        channelId: true,
        createdAt: true,
      },
    });

    if (!conversation) {
      return null;
    }

    return this.getConversationSeenCutoffAt(
      fallbackChannelId ?? conversation.channelId,
      conversation.createdAt,
    );
  }

  private async enrichActivityWithConversationCutoff(
    params: CreateActivityParams,
  ): Promise<CreateActivityParams> {
    if (params.conversationSeenCutoffAt !== undefined) {
      return params;
    }

    const messageId = this.getActivityMessageId(params);
    if (!messageId) {
      return params;
    }

    const message = await this.prisma.message.findUnique({
      where: { messageId },
      select: {
        messageId: true,
        conversationId: true,
        conversation: {
          select: {
            channelId: true,
            createdAt: true,
            initialMessageId: true,
          },
        },
      },
    });

    if (!message?.conversation) {
      return params;
    }

    const channelId = params.channelId ?? message.conversation.channelId;
    return {
      ...params,
      conversationId: params.conversationId ?? message.conversationId,
      channelId,
      conversationSeenCutoffAt: await this.getConversationSeenCutoffAt(
        channelId,
        message.conversation.createdAt,
      ),
    };
  }

  private async enrichActivitiesWithConversationCutoff(
    activities: CreateActivityParams[],
  ): Promise<CreateActivityParams[]> {
    const messageIds = [
      ...new Set(
        activities
          .filter(activity => activity.conversationSeenCutoffAt === undefined)
          .map(activity => this.getActivityMessageId(activity))
          .filter((messageId): messageId is string => Boolean(messageId)),
      ),
    ];

    if (messageIds.length === 0) {
      return activities;
    }

    const messages = await this.prisma.message.findMany({
      where: { messageId: { in: messageIds } },
      select: {
        messageId: true,
        conversationId: true,
        conversation: {
          select: {
            channelId: true,
            createdAt: true,
          },
        },
      },
    });

    const messageById = new Map(messages.map(message => [message.messageId, message]));
    const cutoffInputsByConversation = new Map<
      string,
      { channelId: string; targetConversationCreatedAt: Date }
    >();

    for (const activity of activities) {
      if (activity.conversationSeenCutoffAt !== undefined) {
        continue;
      }

      const messageId = this.getActivityMessageId(activity);
      if (!messageId) {
        continue;
      }

      const message = messageById.get(messageId);
      if (!message?.conversation) {
        continue;
      }

      const channelId = activity.channelId ?? message.conversation.channelId;
      cutoffInputsByConversation.set(message.conversationId, {
        channelId,
        targetConversationCreatedAt: message.conversation.createdAt,
      });
    }

    const cutoffEntries = await Promise.all(
      [...cutoffInputsByConversation.entries()].map(
        async ([conversationId, input]): Promise<[string, Date | null]> => [
          conversationId,
          await this.getConversationSeenCutoffAt(
            input.channelId,
            input.targetConversationCreatedAt,
          ),
        ],
      ),
    );
    const cutoffByConversationId = new Map<string, Date | null>(cutoffEntries);

    return activities.map(activity => {
      if (activity.conversationSeenCutoffAt !== undefined) {
        return activity;
      }

      const messageId = this.getActivityMessageId(activity);
      if (!messageId) {
        return activity;
      }

      const message = messageById.get(messageId);
      if (!message?.conversation) {
        return activity;
      }

      return {
        ...activity,
        conversationId: activity.conversationId ?? message.conversationId,
        channelId: activity.channelId ?? message.conversation.channelId,
        conversationSeenCutoffAt: cutoffByConversationId.get(message.conversationId) ?? null,
      };
    });
  }

  /**
   * Create a single activity
   */
  async createActivity(params: CreateActivityParams): Promise<void> {
    const activity = await this.enrichActivityWithConversationCutoff(params);
    logger.info('[ActivityService] Creating activity', {
      activityId: activity.id,
      userId: activity.userId,
      actorAction: activity.actorAction,
      actionSource: activity.actionSource,
      actionSourceId: activity.actionSourceId,
      messageId: activity.messageId,
      reactionId: activity.reactionId,
      callId: activity.callId,
      ticketId: activity.ticketId,
      conversationId: activity.conversationId,
      channelId: activity.channelId,
      conversationSeenCutoffAt: activity.conversationSeenCutoffAt,
      actorId: activity.actorId,
      classification: activity.classification,
    });
    const workspaceId = await this.resolveWorkspaceId(activity);
    const result = await this.prisma.activity.create({
      data: {
        ...(activity.id ? { id: activity.id } : {}),
        userId: activity.userId,
        workspaceId,
        actorAction: activity.actorAction,
        actionSource: activity.actionSource,
        actionSourceId: activity.actionSourceId,
        ...(activity.messageId ? { messageId: activity.messageId } : {}),
        ...(activity.reactionId ? { reactionId: activity.reactionId } : {}),
        ...(activity.callId ? { callId: activity.callId } : {}),
        ...(activity.ticketId ? { ticketId: activity.ticketId } : {}),
        ...(activity.conversationId ? { conversationId: activity.conversationId } : {}),
        ...(activity.pullRequestId ? { pullRequestId: activity.pullRequestId } : {}),
        ...(activity.canvasId ? { canvasId: activity.canvasId } : {}),
        ...(activity.blockId ? { blockId: activity.blockId } : {}),
        ...(activity.conversationSeenCutoffAt
          ? { conversationSeenCutoffAt: activity.conversationSeenCutoffAt }
          : {}),
        channelId: activity.channelId,
        actorId: activity.actorId,
        ...(activity.classification ? { classification: activity.classification } : {}),
        ...(activity.classificationJobType !== undefined
          ? { classificationJobType: activity.classificationJobType }
          : {}),
        ...(activity.classificationConfidence !== undefined
          ? { classificationConfidence: activity.classificationConfidence }
          : {}),
        ...(activity.isThreadActivity !== undefined ? { isThreadActivity: activity.isThreadActivity } : {}),
        isRead: activity.actionSource === 'reaction',
      },
    });
    logger.info('[ActivityService] Activity persisted', {
      activityId: result.id,
      userId: result.userId,
      actorAction: result.actorAction,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      classification: result.classification,
      isRead: result.isRead,
      ticketId: result.ticketId,
    });
  }

  /**
   * Create multiple activities in batch (for multiple users)
   */
  async createActivities(activities: CreateActivityParams[]): Promise<void> {
    if (activities.length === 0) return;
    const enrichedActivities = await this.enrichActivitiesWithConversationCutoff(activities);

    logger.info('[ActivityService] Creating activities batch', {
      count: enrichedActivities.length,
      activityIds: enrichedActivities.map(activity => activity.id).filter(Boolean),
      actorActions: [...new Set(enrichedActivities.map(activity => activity.actorAction))],
      actionSources: [...new Set(enrichedActivities.map(activity => activity.actionSource))],
      channelIds: [
        ...new Set(
          enrichedActivities
            .map(activity => activity.channelId)
            .filter((channelId): channelId is string => Boolean(channelId)),
        ),
      ],
      classifications: [
        ...new Set(enrichedActivities.map(activity => activity.classification).filter(Boolean)),
      ],
    });

    const workspaceIds = await Promise.all(
      enrichedActivities.map(a => this.resolveWorkspaceId(a)),
    );
    await this.prisma.activity.createMany({
      data: enrichedActivities.map((a, i) => ({
        ...(a.id ? { id: a.id } : {}),
        userId: a.userId,
        workspaceId: workspaceIds[i],
        actorAction: a.actorAction,
        actionSource: a.actionSource,
        actionSourceId: a.actionSourceId,
        ...(a.messageId ? { messageId: a.messageId } : {}),
        ...(a.reactionId ? { reactionId: a.reactionId } : {}),
        ...(a.callId ? { callId: a.callId } : {}),
        ...(a.ticketId ? { ticketId: a.ticketId } : {}),
        ...(a.conversationId ? { conversationId: a.conversationId } : {}),
        ...(a.pullRequestId ? { pullRequestId: a.pullRequestId } : {}),
        ...(a.canvasId ? { canvasId: a.canvasId } : {}),
        ...(a.blockId ? { blockId: a.blockId } : {}),
        ...(a.conversationSeenCutoffAt
          ? { conversationSeenCutoffAt: a.conversationSeenCutoffAt }
          : {}),
        channelId: a.channelId,
        actorId: a.actorId,
        ...(a.classification ? { classification: a.classification } : {}),
        ...(a.classificationJobType !== undefined
          ? { classificationJobType: a.classificationJobType }
          : {}),
        ...(a.classificationConfidence !== undefined
          ? { classificationConfidence: a.classificationConfidence }
          : {}),
        ...(a.isThreadActivity !== undefined ? { isThreadActivity: a.isThreadActivity } : {}),
        isRead: a.actionSource === 'reaction',
      })),
    });

    logger.info('[ActivityService] Activities batch persisted', {
      count: activities.length,
    });
  }

  async deleteActivitiesBySource(actionSource: string, actionSourceId: string): Promise<void> {
    return withWorkspaceScope(async () => {
      await this.prisma.activity.deleteMany({
        where: {
          actionSource,
          actionSourceId,
        },
      });
    });
  }

  async deleteActivitiesBySourceIds(actionSource: string, actionSourceIds: string[]): Promise<void> {
    return withWorkspaceScope(async () => {
      if (actionSourceIds.length === 0) return;

      await this.prisma.activity.deleteMany({
        where: {
          actionSource,
          actionSourceId: { in: actionSourceIds },
        },
      });
    });
  }


  /**
   * Upsert a reaction activity (V2)
   * For batched reaction activities (one activity per message)
   */
  async upsertReactionActivityV2(params: {
    messageId: string;
    channelId: string;
    workspaceId?: string;
    actorId: string;
    messageAuthorId: string;
    isThreadActivity?: boolean;
  }): Promise<'created' | 'updated'> {
    const { messageId, channelId, workspaceId, actorId, messageAuthorId, isThreadActivity } = params;

    const existingActivity = await this.prisma.activity.findFirst({
      where: {
        userId: messageAuthorId,
        messageId: messageId,
        actorAction: 'added_v2',
        actionSource: 'message',
      },
    });

    if (existingActivity) {
      const activity = await this.enrichActivityWithConversationCutoff({
        userId: messageAuthorId,
        workspaceId,
        actorAction: 'added_v2',
        actionSource: 'message',
        actionSourceId: messageId,
        messageId,
        channelId,
        actorId,
        isThreadActivity,
      });

      const conversationSeenCutoffAt = existingActivity.conversationSeenCutoffAt
        ? null
        : activity.conversationSeenCutoffAt;

      await this.prisma.activity.update({
        where: { id: existingActivity.id },
        data: {
          actorId: actorId,
          isRead: false,
          updatedAt: new Date(),
          ...(isThreadActivity !== undefined ? { isThreadActivity } : {}),
          ...(conversationSeenCutoffAt ? { conversationSeenCutoffAt } : {}),
        },
      });

      logger.info('[ActivityService] Updated existing reaction activity (v2)', {
        activityId: existingActivity.id,
        messageId,
        newActorId: actorId,
      });

      return 'updated';
    }

    const activity = await this.enrichActivityWithConversationCutoff({
      userId: messageAuthorId,
      workspaceId,
      actorAction: 'added_v2',
      actionSource: 'message',
      actionSourceId: messageId,
      messageId,
      channelId,
      actorId,
      classification: ActivityClassification.FYI,
      isThreadActivity,
    });

    const resolvedWorkspaceId = await this.resolveWorkspaceId({
      workspaceId: activity.workspaceId,
      channelId: activity.channelId ?? channelId,
    });
    await this.prisma.activity.create({
      data: {
        userId: activity.userId,
        workspaceId: resolvedWorkspaceId,
        actorAction: activity.actorAction,
        actionSource: activity.actionSource,
        actionSourceId: activity.actionSourceId,
        messageId: activity.messageId,
        ...(activity.conversationId ? { conversationId: activity.conversationId } : {}),
        channelId: activity.channelId,
        actorId: activity.actorId,
        isRead: false,
        classification: activity.classification,
        ...(isThreadActivity !== undefined ? { isThreadActivity } : {}),
        ...(activity.conversationSeenCutoffAt
          ? { conversationSeenCutoffAt: activity.conversationSeenCutoffAt }
          : {}),
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
    workspaceId?: string;
    actorId: string;
    recipientUserId: string;
    latestReplyMessageId: string;
  }): Promise<'created' | 'updated'> {
    return withWorkspaceScope(async () => {
      const {
        conversationId,
        channelId,
        workspaceId,
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
        const conversationSeenCutoffAt =
          existingActivity.conversationSeenCutoffAt ??
          (await this.getConversationSeenCutoffAtForConversation(conversationId, channelId));

        await this.prisma.activity.update({
          where: { id: existingActivity.id },
          data: {
            actorId: actorId,
            isRead: false,
            messageId: latestReplyMessageId,
            updatedAt: new Date(),
            actionSourceId: latestReplyMessageId,
            ...(conversationSeenCutoffAt ? { conversationSeenCutoffAt } : {}),
          },
        });

        logger.info('[ActivityService] Updated existing reply activity (v2)', {
          activityId: existingActivity.id,
          conversationId,
          newActorId: actorId,
        });

        return 'updated';
      }

      const conversationSeenCutoffAt = await this.getConversationSeenCutoffAtForConversation(
        conversationId,
        channelId,
      );

      const resolvedWorkspaceId = await this.resolveWorkspaceId({ workspaceId, channelId });
      await this.prisma.activity.create({
        data: {
          userId: recipientUserId,
          workspaceId: resolvedWorkspaceId,
          actorAction: 'replied_v2',
          actionSource: 'message',
          actionSourceId: latestReplyMessageId,
          messageId: latestReplyMessageId,
          conversationId,
          channelId: channelId,
          actorId: actorId,
          isRead: false,
          isThreadActivity: true,
          classification: ActivityClassification.FYI,
          ...(conversationSeenCutoffAt ? { conversationSeenCutoffAt } : {}),
        },
      });

      logger.info('[ActivityService] Created new reply activity (v2)', {
        conversationId,
        actorId,
      });

      return 'created';
    });
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
        updatedAt: new Date(),
      },
    });
  }

  async getWorkspaceActivityCounts(memberId: string): Promise<
    Array<{
      workspaceId: string;
      userId: string;
      count: number;
    }>
  > {
    // Spans the caller's own identities across workspaces.
    return runAsSystem(async () => {
      const users = await this.prisma.user.findMany({
        where: {
          orgMemberId: memberId,
          leftAt: null,
          status: UserStatus.ACTIVE,
        },
        select: {
          id: true,
          workspaceId: true,
        },
      });

      if (users.length === 0) {
        return [];
      }

      const userIds = users.map(u => u.id);

      const activityCounts = await this.prisma.activity.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          isRead: false,
        },
        _count: {
          id: true,
        },
      });

      const countMap = new Map<string, number>();
      for (const ac of activityCounts) {
        countMap.set(ac.userId, ac._count.id);
      }

      return users.map(u => ({
        workspaceId: u.workspaceId,
        userId: u.id,
        count: countMap.get(u.id) ?? 0,
      }));
    });
  }
}

// Singleton instance
export const activityService = new ActivityService(db);
