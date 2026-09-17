import { PrismaClient } from '@prisma/client';
import {
  ActivityClassification,
  ActivityClassificationJobType,
  ChannelScopeType,
  UserStatus,
  BELL_COUNT_RULES,
  BELL_EXCLUDED_ACTOR_ACTIONS,
  BELL_EXCLUDED_CLASSIFICATIONS,
  BELL_EXCLUDED_LEGACY_DIRECT_MESSAGES,
  BELL_EXCLUDE_CLOSED_CHANNELS,
  DM_SHELF_CHANNEL_SCOPES,
  DM_SHELF_MENTION_ACTOR_ACTIONS,
} from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { currentWorkspaceId, withWorkspaceScope, runAsSystem } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import {
  isSdlcChannel,
  sdlcConversationOwner,
  sdlcConversationTicket,
  sdlcTicketConversation,
} from '@/sdlc/sdlcNavTarget';

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
  trackId?: string;
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

  /** The artifact or track owning the conversation, else its ticket. Stamped so the feed needs no join. */
  private async sdlcOwner(row: {
    channelId?: string | null;
    conversationId?: string | null;
    ticketId?: string | null;
    canvasId?: string | null;
  }): Promise<{ canvasId?: string; trackId?: string; ticketId?: string; conversationId?: string }> {
    const { channelId } = row;
    if (!channelId || row.canvasId || (!row.conversationId && !row.ticketId)) return {};
    try {
      if (!(await isSdlcChannel(channelId))) return {};
      const conversationId =
        row.conversationId ?? (row.ticketId ? await sdlcTicketConversation(row.ticketId) : null);
      if (!conversationId) return {};

      const owner = await sdlcConversationOwner(conversationId);
      if (owner) {
        return owner.sourceType === 'CANVAS'
          ? { canvasId: owner.sourceId, conversationId }
          : { trackId: owner.sourceId, conversationId };
      }
      if (row.ticketId) return {};
      const ticketId = await sdlcConversationTicket(conversationId);
      return ticketId ? { ticketId } : {};
    } catch (error) {
      logger.error('[ActivityService] SDLC owner lookup failed', { row, error });
      return {};
    }
  }

  /**
   * Create a single activity
   */
  async createActivity(params: CreateActivityParams): Promise<void> {
    const enriched = await this.enrichActivityWithConversationCutoff(params);
    const activity = { ...enriched, ...(await this.sdlcOwner(enriched)) };
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
        ...(activity.trackId ? { trackId: activity.trackId } : {}),
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
    const enrichedActivities = await Promise.all(
      (await this.enrichActivitiesWithConversationCutoff(activities)).map(async a => ({
        ...a,
        ...(await this.sdlcOwner(a)),
      })),
    );

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
        ...(a.trackId ? { trackId: a.trackId } : {}),
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
    const owned = await this.sdlcOwner(activity);
    await this.prisma.activity.create({
      data: {
        userId: activity.userId,
        workspaceId: resolvedWorkspaceId,
        actorAction: activity.actorAction,
        actionSource: activity.actionSource,
        actionSourceId: activity.actionSourceId,
        messageId: activity.messageId,
        ...(activity.conversationId ? { conversationId: activity.conversationId } : {}),
        ...(owned.canvasId ? { canvasId: owned.canvasId } : {}),
        ...(owned.trackId ? { trackId: owned.trackId } : {}),
        ...(owned.ticketId ? { ticketId: owned.ticketId } : {}),
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
      const owned = await this.sdlcOwner({ channelId, conversationId });
      await this.prisma.activity.create({
        data: {
          userId: recipientUserId,
          workspaceId: resolvedWorkspaceId,
          actorAction: 'replied_v2',
          actionSource: 'message',
          actionSourceId: latestReplyMessageId,
          messageId: latestReplyMessageId,
          conversationId,
          ...(owned.canvasId ? { canvasId: owned.canvasId } : {}),
          ...(owned.trackId ? { trackId: owned.trackId } : {}),
          ...(owned.ticketId ? { ticketId: owned.ticketId } : {}),
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
      },
    });
  }

  /**
   * Per-workspace unread counts spanning the caller's own identities.
   *
   * `count` = dmCount + bellCount + callCount (the unread badge invariant —
   * every event lands in exactly one shelf; the dock renders the sum over all
   * workspaces):
   * - dmCount   = Σ channel_user_status.unreadCount over the user's open
   *               DM/GROUP_DM channels, minus unread top-level mention
   *               activities in GROUP_DM channels (mention wins the bucket),
   *               floored at 0 per channel.
   * - bellCount = COUNT(unread activities) per the shared BELL_COUNT_RULES.
   * - callCount = COUNT(unread missed_call activities) — same semantics as the
   *               Calls rail's `userMissedCalls` Zero query.
   *
   * Rows are merged server-side per workspaceId, so a member holding two
   * identities in one workspace sums instead of racing last-write-wins on the
   * client.
   */
  async getWorkspaceActivityCounts(memberId: string): Promise<
    Array<{
      workspaceId: string;
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

      // dmCount: open DM/GROUP_DM channel_user_status.unreadCount per user.
      const dmStatuses = await this.prisma.channelUserStatus.findMany({
        where: {
          userId: { in: userIds },
          isClosed: false,
          isDeleted: false,
          channel: {
            scopeType: { in: [...DM_SHELF_CHANNEL_SCOPES] },
          },
        },
        select: {
          userId: true,
          unreadCount: true,
          channel: {
            select: {
              id: true,
              scopeType: true,
            },
          },
        },
      });

      // dm shelf subtraction: unread top-level mention activities in GROUP_DM
      // channels (mentioned_user / group_mention) are counted by the bell, so
      // they must not also inflate the dm shelf's unreadCount totals.
      // Activity has no Prisma relation to Channel (only Zero does), so scope
      // via channelId set derived from the open GROUP_DM statuses above —
      // dmCount only sums open channels, so the subtraction only matters there.
      const groupDmChannelIds = dmStatuses
        .filter(s => s.channel?.scopeType === ChannelScopeType.GROUP_DM)
        .map(s => s.channel.id);

      const groupDmMentionCounts =
        groupDmChannelIds.length > 0
          ? await this.prisma.activity.groupBy({
              by: ['userId', 'channelId'],
              where: {
                userId: { in: userIds },
                isRead: false,
                actorAction: { in: [...DM_SHELF_MENTION_ACTOR_ACTIONS] },
                actionSource: 'message',
                isThreadActivity: false,
                channelId: { in: groupDmChannelIds },
              },
              _count: {
                id: true,
              },
            })
          : [];

      // channelId -> userId -> mention rows, for per-channel subtraction.
      const groupDmMentions = new Map<string, Map<string, number>>();
      for (const row of groupDmMentionCounts) {
        if (!row.channelId) continue;
        let byUser = groupDmMentions.get(row.channelId);
        if (!byUser) {
          byUser = new Map();
          groupDmMentions.set(row.channelId, byUser);
        }
        byUser.set(row.userId, row._count.id);
      }

      // bellCount per the shared rules (excludes added_v2/removed, missed_call,
      // SKIP, legacy direct_message; excludes closed channels; ERROR/PENDING count).
      // Closed state is per-user on channel_user_status (userId+channelId), so
      // group by that pair and post-filter against the closed pairs below —
      // Activity has no Prisma channel relation, and a plain channelId notIn
      // would over-exclude other identities' activities in the same channel.
      // channelId null (ticket activities) always counts.
      const bellChannelCounts = await this.prisma.activity.groupBy({
        by: ['userId', 'channelId'],
        where: {
          userId: { in: userIds },
          isRead: false,
          actorAction: {
            notIn: [
              ...BELL_EXCLUDED_ACTOR_ACTIONS,
              ...(BELL_EXCLUDED_LEGACY_DIRECT_MESSAGES ? ['direct_message'] : []),
            ],
          },
          NOT: {
            AND: [
              { actionSource: BELL_COUNT_RULES.excludedCalls.actionSource },
              { actorAction: BELL_COUNT_RULES.excludedCalls.actorAction },
            ],
          },
          classification: { notIn: [...BELL_EXCLUDED_CLASSIFICATIONS] },
        },
        _count: {
          id: true,
        },
      });

      // Channels closed *for this user* (isClosed/isDeleted are per-user flags).
      const closedStatuses = BELL_EXCLUDE_CLOSED_CHANNELS
        ? await this.prisma.channelUserStatus.findMany({
            where: {
              userId: { in: userIds },
              OR: [{ isClosed: true }, { isDeleted: true }],
            },
            select: { userId: true, channelId: true },
          })
        : [];

      const closedChannelsByUser = new Map<string, Set<string>>();
      for (const status of closedStatuses) {
        let channels = closedChannelsByUser.get(status.userId);
        if (!channels) {
          channels = new Set();
          closedChannelsByUser.set(status.userId, channels);
        }
        channels.add(status.channelId);
      }

      const bellByUser = new Map<string, number>();
      for (const row of bellChannelCounts) {
        if (
          row.channelId &&
          closedChannelsByUser.get(row.userId)?.has(row.channelId)
        ) {
          continue;
        }
        bellByUser.set(row.userId, (bellByUser.get(row.userId) ?? 0) + row._count.id);
      }

      // callCount: unread missed_call activities, same semantics as the Calls
      // rail's userMissedCalls Zero query.
      const callCounts = await this.prisma.activity.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          isRead: false,
          actorAction: 'missed_call',
        },
        _count: {
          id: true,
        },
      });

      const callByUser = new Map<string, number>();
      for (const row of callCounts) {
        callByUser.set(row.userId, row._count.id);
      }

      // Merge identities per workspace (groupBy workspaceId, SUM).
      const countByWorkspace = new Map<string, number>();
      for (const u of users) {
        const dmCount = dmStatuses
          .filter(s => s.userId === u.id)
          .reduce((sum, status) => {
            const mentionRows =
              status.channel?.scopeType === ChannelScopeType.GROUP_DM
                ? (groupDmMentions.get(status.channel.id)?.get(u.id) ?? 0)
                : 0;
            return sum + Math.max(0, status.unreadCount - mentionRows);
          }, 0);
        const bellCount = bellByUser.get(u.id) ?? 0;
        const callCount = callByUser.get(u.id) ?? 0;
        countByWorkspace.set(
          u.workspaceId,
          (countByWorkspace.get(u.workspaceId) ?? 0) + dmCount + bellCount + callCount,
        );
      }

      return Array.from(countByWorkspace, ([workspaceId, count]) => ({
        workspaceId,
        count,
      }));
    });
  }
}

// Singleton instance
export const activityService = new ActivityService(db);
