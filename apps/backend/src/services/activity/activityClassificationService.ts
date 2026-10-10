import { Activity } from '@prisma/client';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { extractAllMentions } from '@/utils/mentionParser';
import { extractSpecialMentions } from '@/utils/mentionUtils';
import { generatePlainTextContent } from '@/utils/contentUtils';
import { logger } from '@/utils/logger';
import { ActivityClassification } from '@xyne/shared';
import { classifyActivityWithJev } from '@/services/activity/activityClassificationJev';

const ACTIVITY_CLASSIFICATION_CONTEXT_LIMIT = 0;
const ACTIVITY_CLASSIFICATION_THREAD_LIMIT = 10;
const GROUP_MEMBER_LIMIT = 10;

type GroupMemberSummary = {
  memberCount: number;
  members: string[];
};

type ActivityClassificationGroupSummary = {
  name?: string | null;
  alias?: string | null;
  memberCount?: number | null;
  members?: string[];
};

type ActivityClassificationRecipientSummary = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  channelRole?: string | null;
  groups: ActivityClassificationGroupSummary[];
};

interface ActivityClassificationPromptInput {
  actorAction: string;
  actionSource: string;
  recipient?: ActivityClassificationRecipientSummary | null;
  recipients?: ActivityClassificationRecipientSummary[] | null;
  channel?: {
    name?: string | null;
    scopeType?: string | null;
    visibility?: string | null;
    userRole?: string | null;
    participantCount?: number | null;
  } | null;
  message?: {
    createdAt: number;
    senderName?: string | null;
    contentText?: string | null;
    mentions: {
      users: string[];
      groups: string[];
      hasChannel: boolean;
      hasHere: boolean;
    };
    isThreadReply: boolean;
    threadIndex?: number | null;
    attachments?: {
      imageCount: number;
      fileCount: number;
      linkCount: number;
    };
  } | null;
  mentionedGroups?: ActivityClassificationGroupSummary[];
  threadContext?: {
    initialMessage?: {
      senderName?: string | null;
      contentText?: string | null;
      createdAt?: number | null;
      threadIndex?: number | null;
    } | null;
    messages?: Array<{
      senderName?: string | null;
      contentText?: string | null;
      createdAt: number;
      threadIndex?: number | null;
    }>;
  } | null;
  previousMessages?: Array<{
    senderName?: string | null;
    contentText?: string | null;
    createdAt: number;
  }>;
}

interface ActivityClassificationAudiencePromptInput {
  actorAction: string;
  actionSource: string;
  recipients: ActivityClassificationRecipientSummary[];
  channel?: {
    name?: string | null;
    scopeType?: string | null;
    visibility?: string | null;
    participantCount?: number | null;
  } | null;
  message?: {
    createdAt: number;
    senderName?: string | null;
    contentText?: string | null;
    mentions: {
      users: string[];
      groups: string[];
      hasChannel: boolean;
      hasHere: boolean;
    };
    isThreadReply: boolean;
    threadIndex?: number | null;
    attachments?: {
      imageCount: number;
      fileCount: number;
      linkCount: number;
    };
  } | null;
  mentionedGroups?: ActivityClassificationGroupSummary[];
  threadContext?: {
    initialMessage?: {
      senderName?: string | null;
      contentText?: string | null;
      createdAt?: number | null;
      threadIndex?: number | null;
    } | null;
    messages?: Array<{
      senderName?: string | null;
      contentText?: string | null;
      createdAt: number;
      threadIndex?: number | null;
    }>;
  } | null;
  previousMessages?: Array<{
    senderName?: string | null;
    contentText?: string | null;
    createdAt: number;
  }>;
}

type ThreadContextResult = {
  threadContext: ActivityClassificationPromptInput['threadContext'];
  currentMessageIndex: number | null;
};

export class ActivityClassificationService {

  async classifyActivity(activityId: string): Promise<{
    status: 'classified' | 'pending' | 'error' | 'skipped';
    classification?: ActivityClassification;
    confidence?: number | null;
    usedJev?: boolean;
    reason?: string;
  }> {
    logger.debug('[ActivityClassification] Starting classification', { activityId });
    const activity = await db.activity.findUnique({
      where: { id: activityId },
    });

    if (!activity) {
      logger.warn('[ActivityClassification] Activity not found', { activityId });
      return { status: 'skipped', reason: 'not_found' };
    }

    if (activity.classification) {
      const pendingStates = new Set<ActivityClassification>([
        ActivityClassification.PENDING,
        ActivityClassification.PENDING_CLASSIFY,
        ActivityClassification.PROCESSING,
      ]);
      if (!pendingStates.has(activity.classification as ActivityClassification)) {
        logger.debug('[ActivityClassification] Activity already classified, skipping', {
          activityId,
          classification: activity.classification,
        });
        return {
          status: 'skipped',
          reason: 'already_classified',
          classification: activity.classification as ActivityClassification,
        };
      }
    }

    if (activity.actionSource !== 'message') {
      await this.updateClassification(activity.id, ActivityClassification.FYI, null);
      return {
        status: 'classified',
        classification: ActivityClassification.FYI,
        confidence: null,
        usedJev: false,
      };
    }

    logger.debug('[ActivityClassification] Building classification input', { activityId });
    const inputPayload = await this.buildClassificationInput(activity);
    if (!inputPayload) {
      logger.error('[ActivityClassification] Failed to build classification input', { activityId });
      await this.updateClassification(activity.id, ActivityClassification.ERROR, null);
      return { status: 'error', usedJev: false, reason: 'input_build_failed' };
    }

    // Jev, on the JSON the LLM prompt used to be filled with. SKIP is only ever valid for DMs.
    const jev = await classifyActivityWithJev(inputPayload as unknown as Record<string, unknown>, {
      allowSkip: inputPayload.actorAction === 'direct_message',
      audience: false,
      logId: activityId,
    });
    if (!jev.ok) {
      // Left PENDING: the worker retries it, and marks it ERROR once retries run out.
      logger.warn('[ActivityClassification] Jev had no answer, leaving the activity PENDING', {
        activityId,
        reason: jev.reason,
      });
      return { status: 'pending', usedJev: true, reason: `jev_${jev.reason}` };
    }

    const mappedClassification = this.mapClassification(jev.classification, activity.actorAction);
    logger.info('[ActivityClassification] Classified', {
      activityId,
      classification: mappedClassification,
      confidence: jev.confidence,
      jevChoice: jev.jevChoice,
    });
    await this.updateClassification(activity.id, mappedClassification, jev.confidence);
    return {
      status: 'classified',
      classification: mappedClassification,
      confidence: jev.confidence,
      usedJev: true,
    };
  }

  async classifySpecialMentionAudience(params: {
    activityIds: string[];
    messageId: string;
    channelId: string;
    recipientUserIds: string[];
  }): Promise<{
    status: 'classified' | 'pending' | 'error' | 'skipped';
    classification?: ActivityClassification;
    confidence?: number | null;
    usedJev?: boolean;
    reason?: string;
  }> {
    const { activityIds, messageId, channelId, recipientUserIds } = params;
    if (activityIds.length === 0 || recipientUserIds.length === 0) {
      return { status: 'skipped', reason: 'empty_audience' };
    }

    logger.debug('[ActivityClassification] Building audience classification input', {
      messageId,
      channelId,
      recipientCount: recipientUserIds.length,
    });
    const inputPayload = await this.buildAudienceClassificationInput(
      messageId,
      channelId,
      recipientUserIds
    );
    if (!inputPayload) {
      logger.error('[ActivityClassification] Failed to build audience classification input', {
        messageId,
        channelId,
      });
      await this.updateClassificationAudience(activityIds, ActivityClassification.ERROR, null);
      return { status: 'error', usedJev: false, reason: 'input_build_failed' };
    }

    // One Jev call for the whole audience, as the LLM call was. Never SKIP: it is not a DM.
    const jev = await classifyActivityWithJev(inputPayload as unknown as Record<string, unknown>, {
      allowSkip: false,
      audience: true,
      logId: `${messageId} (${activityIds.length} recipients)`,
    });
    if (!jev.ok) {
      logger.warn('[ActivityClassification] Jev had no answer, leaving the audience PENDING', {
        messageId,
        reason: jev.reason,
      });
      return { status: 'pending', usedJev: true, reason: `jev_${jev.reason}` };
    }

    const mappedClassification = this.mapClassification(jev.classification, inputPayload.actorAction);
    logger.info('[ActivityClassification] Audience classified', {
      messageId,
      classification: mappedClassification,
      confidence: jev.confidence,
      jevChoice: jev.jevChoice,
    });
    await this.updateClassificationAudience(activityIds, mappedClassification, jev.confidence);
    return {
      status: 'classified',
      classification: mappedClassification,
      confidence: jev.confidence,
      usedJev: true,
    };
  }

  private async buildClassificationInput(
    activity: Activity
  ): Promise<ActivityClassificationPromptInput | null> {
    logger.debug('[ActivityClassification] Fetching message for activity', {
      activityId: activity.id,
      actionSourceId: activity.actionSourceId,
    });
    const message = await db.message.findUnique({
      where: { messageId: activity.actionSourceId },
    });

    if (!message) {
      logger.warn('[ActivityClassification] Message not found for activity', {
        activityId: activity.id,
        actionSourceId: activity.actionSourceId,
      });
      return null;
    }

    logger.debug('[ActivityClassification] Fetching conversation/channel', {
      activityId: activity.id,
      conversationId: message.conversationId,
    });
    const conversation = await db.conversation.findUnique({
      where: { conversationId: message.conversationId },
    });

    const channel = conversation
      ? await db.channel.findUnique({ where: { id: conversation.channelId } })
      : null;

    logger.debug('[ActivityClassification] Channel resolved', {
      activityId: activity.id,
      channelId: channel?.id,
      scopeType: channel?.scopeType,
      visibility: channel?.visibility,
    });

    const channelParticipant = channel
      ? await db.channelParticipant.findUnique({
          where: {
            channelId_userId: {
              channelId: channel.id,
              userId: activity.userId,
            },
          },
        })
      : null;

    logger.debug('[ActivityClassification] Channel participant resolved', {
      activityId: activity.id,
      channelId: channel?.id,
      userId: activity.userId,
      role: channelParticipant?.role,
    });

    logger.debug('[ActivityClassification] Fetching user with mappings', {
      activityId: activity.id,
      userId: activity.userId,
    });
    const userWithMappings = await repositories.users.findWithMappings(activity.userId);
    const userGroupRefs =
      userWithMappings?.userGroupMappings
        ?.map(mapping => ({
          id: mapping.userGroup?.id || mapping.userGroupId,
          name: mapping.userGroup?.name || null,
          alias: mapping.userGroup?.alias || null,
        }))
        .filter(group => Boolean(group.id)) || [];

    logger.debug('[ActivityClassification] User mappings resolved', {
      activityId: activity.id,
      userId: activity.userId,
      groupCount: userGroupRefs.length,
    });

    const contentHtml = message.content || '';
    const contentText = generatePlainTextContent(contentHtml);
    const mentions = extractAllMentions(contentHtml);
    const specialMentions = extractSpecialMentions(contentHtml);

    logger.debug('[ActivityClassification] Mentions extracted', {
      activityId: activity.id,
      userMentions: mentions.userIds,
      groupMentions: mentions.groupIds,
      specialMentions,
    });

    const mentionedGroups = mentions.groupIds.length
      ? await db.userGroup.findMany({
          where: { id: { in: mentions.groupIds } },
          select: { id: true, name: true, alias: true },
        })
      : [];

    logger.debug('[ActivityClassification] Mentioned groups resolved', {
      activityId: activity.id,
      mentionedGroupCount: mentionedGroups.length,
    });

    const mentionedGroupMap = new Map(mentionedGroups.map(group => [group.id, group]));
    const groupSummaryIds = [
      ...new Set([...userGroupRefs.map(group => group.id), ...mentions.groupIds]),
    ];
    const groupSummaries = await this.getGroupMemberSummaries(groupSummaryIds);

    const mentionUserNameMap = await this.getUserNameMap([
      ...mentions.userIds,
      message.senderId,
    ]);
    const mentionedUserNames = [
      ...new Set(
        mentions.userIds
          .map(userId => mentionUserNameMap.get(userId))
          .filter((name): name is string => Boolean(name))
      ),
    ];

    const mentionedGroupNames = [
      ...new Set(
        mentions.groupIds
          .map(groupId => {
            const group = mentionedGroupMap.get(groupId);
            return group?.name || group?.alias || null;
          })
          .filter((name): name is string => Boolean(name))
      ),
    ];

    const userGroups = userGroupRefs.map(group => {
      const summary = groupSummaries.get(group.id);
      return {
        name: group.name,
        alias: group.alias,
        memberCount: summary?.memberCount ?? 0,
        members: summary?.members ?? [],
      };
    });

    const mentionedGroupsPayload = mentionedGroups.map(group => {
      const summary = groupSummaries.get(group.id);
      return {
        name: group.name,
        alias: group.alias,
        memberCount: summary?.memberCount ?? 0,
        members: summary?.members ?? [],
      };
    });

    const isThreadReply =
      conversation?.initialMessageId ? message.messageId !== conversation.initialMessageId : false;

    logger.debug('[ActivityClassification] Thread context flags', {
      activityId: activity.id,
      isThreadReply,
      initialMessageId: conversation?.initialMessageId,
    });

    const previousMessages = await this.getPreviousMessages(activity.userId, message);
    const threadContextResult = isThreadReply
      ? await this.getThreadContext(activity.userId, message, conversation?.initialMessageId || null)
      : null;
    const threadContext = threadContextResult?.threadContext || null;
    const currentThreadIndex = threadContextResult?.currentMessageIndex ?? null;

    logger.debug('[ActivityClassification] Message context loaded', {
      activityId: activity.id,
      previousMessagesCount: previousMessages.length,
      threadMessagesCount: threadContext?.messages?.length || 0,
    });

    const attachments = await this.getMessageAttachmentSummary(
      message,
      contentHtml,
      contentText
    );

    const channelStatsRecord = channel
      ? await db.channelStats.findUnique({ where: { channelId: channel.id } })
      : null;

    return {
      actorAction: activity.actorAction,
      actionSource: activity.actionSource,
      recipient: {
        id: activity.userId,
        name: userWithMappings?.name || null,
        email: userWithMappings?.email || null,
        channelRole: channelParticipant?.role || null,
        groups: userGroups,
      },
      channel: channel
        ? {
            name: channel.name,
            scopeType: channel.scopeType,
            visibility: channel.visibility,
            userRole: channelParticipant?.role || null,
            participantCount: channelStatsRecord?.participantCount ?? null,
          }
        : null,
      message: {
        createdAt: message.createdAt.getTime(),
        senderName: mentionUserNameMap.get(message.senderId) || null,
        contentText,
        mentions: {
          users: mentionedUserNames,
          groups: mentionedGroupNames,
          hasChannel: specialMentions.hasChannel,
          hasHere: specialMentions.hasHere,
        },
        isThreadReply,
        threadIndex: currentThreadIndex,
        attachments,
      },
      mentionedGroups: mentionedGroupsPayload,
      threadContext,
      previousMessages,
    };
  }

  private async buildAudienceClassificationInput(
    messageId: string,
    channelId: string,
    recipientUserIds: string[]
  ): Promise<ActivityClassificationAudiencePromptInput | null> {
    logger.debug('[ActivityClassification] Fetching message for audience classification', {
      messageId,
      channelId,
    });
    const message = await db.message.findUnique({
      where: { messageId },
    });

    if (!message) {
      logger.warn('[ActivityClassification] Message not found for audience classification', {
        messageId,
      });
      return null;
    }

    const conversation = await db.conversation.findUnique({
      where: { conversationId: message.conversationId },
    });

    const channel = conversation
      ? await db.channel.findUnique({ where: { id: conversation.channelId } })
      : null;

    logger.debug('[ActivityClassification] Audience channel resolved', {
      messageId,
      channelId: channel?.id,
      scopeType: channel?.scopeType,
      visibility: channel?.visibility,
    });

    const uniqueRecipientIds = [...new Set(recipientUserIds.filter(Boolean))];

    const recipientsData = await db.user.findMany({
      where: { id: { in: uniqueRecipientIds } },
      select: { id: true, name: true, email: true },
    });

    const userGroupMappings = await db.userGroupMapping.findMany({
      where: { userId: { in: uniqueRecipientIds } },
      select: { userId: true, userGroupId: true },
    });

    const userGroupIds = [...new Set(userGroupMappings.map(mapping => mapping.userGroupId))];

    const userGroups = userGroupIds.length
      ? await db.userGroup.findMany({
          where: { id: { in: userGroupIds } },
          select: { id: true, name: true, alias: true },
        })
      : [];

    const userGroupMap = new Map(userGroups.map(group => [group.id, group]));
    const userGroupIdsByUser = new Map<string, string[]>();
    userGroupMappings.forEach(mapping => {
      const list = userGroupIdsByUser.get(mapping.userId) || [];
      list.push(mapping.userGroupId);
      userGroupIdsByUser.set(mapping.userId, list);
    });

    const contentHtml = message.content || '';
    const contentText = generatePlainTextContent(contentHtml);
    const mentions = extractAllMentions(contentHtml);
    const specialMentions = extractSpecialMentions(contentHtml);

    const mentionedGroups = mentions.groupIds.length
      ? await db.userGroup.findMany({
          where: { id: { in: mentions.groupIds } },
          select: { id: true, name: true, alias: true },
        })
      : [];

    const mentionedGroupMap = new Map(mentionedGroups.map(group => [group.id, group]));
    const groupSummaryIds = [
      ...new Set([...userGroupIds, ...mentions.groupIds]),
    ];
    const groupSummaries = await this.getGroupMemberSummaries(groupSummaryIds);

    const mentionUserNameMap = await this.getUserNameMap([
      ...mentions.userIds,
      message.senderId,
    ]);
    const mentionedUserNames = [
      ...new Set(
        mentions.userIds
          .map(userId => mentionUserNameMap.get(userId))
          .filter((name): name is string => Boolean(name))
      ),
    ];

    const mentionedGroupNames = [
      ...new Set(
        mentions.groupIds
          .map(groupId => {
            const group = mentionedGroupMap.get(groupId);
            return group?.name || group?.alias || null;
          })
          .filter((name): name is string => Boolean(name))
      ),
    ];

    const channelParticipants = channel
      ? await db.channelParticipant.findMany({
          where: { channelId: channel.id, userId: { in: uniqueRecipientIds } },
          select: { userId: true, role: true },
        })
      : [];
    const channelRoleMap = new Map(channelParticipants.map(p => [p.userId, p.role]));

    const recipients = recipientsData.map(user => {
      const groupIds = userGroupIdsByUser.get(user.id) || [];
      const groups = groupIds
        .map(groupId => {
          const group = userGroupMap.get(groupId);
          if (!group) return null;
          const summary = groupSummaries.get(groupId);
          return {
            name: group.name,
            alias: group.alias,
            memberCount: summary?.memberCount ?? 0,
            members: summary?.members ?? [],
          };
        })
        .filter((group): group is NonNullable<typeof group> => Boolean(group));

      return {
        id: user.id,
        name: user.name || null,
        email: user.email || null,
        channelRole: channelRoleMap.get(user.id) || null,
        groups,
      };
    });

    const mentionedGroupsPayload = mentionedGroups.map(group => {
      const summary = groupSummaries.get(group.id);
      return {
        name: group.name,
        alias: group.alias,
        memberCount: summary?.memberCount ?? 0,
        members: summary?.members ?? [],
      };
    });

    const isThreadReply =
      conversation?.initialMessageId ? message.messageId !== conversation.initialMessageId : false;

    const previousMessages = await this.getPreviousMessages(null, message);
    const threadContextResult = isThreadReply
      ? await this.getThreadContext(null, message, conversation?.initialMessageId || null)
      : null;
    const threadContext = threadContextResult?.threadContext || null;
    const currentThreadIndex = threadContextResult?.currentMessageIndex ?? null;

    const attachments = await this.getMessageAttachmentSummary(message, contentHtml, contentText);

    const audienceChannelStats = channel
      ? await db.channelStats.findUnique({ where: { channelId: channel.id } })
      : null;

    return {
      actorAction: 'group_mention',
      actionSource: 'message',
      recipients,
      channel: channel
        ? {
            name: channel.name,
            scopeType: channel.scopeType,
            visibility: channel.visibility,
            participantCount: audienceChannelStats?.participantCount ?? null,
          }
        : null,
      message: {
        createdAt: message.createdAt.getTime(),
        senderName: mentionUserNameMap.get(message.senderId) || null,
        contentText,
        mentions: {
          users: mentionedUserNames,
          groups: mentionedGroupNames,
          hasChannel: specialMentions.hasChannel,
          hasHere: specialMentions.hasHere,
        },
        isThreadReply,
        threadIndex: currentThreadIndex,
        attachments,
      },
      mentionedGroups: mentionedGroupsPayload,
      threadContext,
      previousMessages,
    };
  }

  private async getPreviousMessages(userId: string | null, message: { conversationId: string; createdAt: Date }) {
    if (ACTIVITY_CLASSIFICATION_CONTEXT_LIMIT <= 0) {
      return [];
    }
    logger.debug('[ActivityClassification] Fetching previous messages', {
      userId,
      conversationId: message.conversationId,
    });
    const visibilityFilter = userId
      ? { OR: [{ visibleTo: null }, { visibleTo: userId }] }
      : { visibleTo: null };
    const previous = await db.message.findMany({
      where: {
        conversationId: message.conversationId,
        createdAt: { lt: message.createdAt },
        ...visibilityFilter,
      },
      orderBy: { createdAt: 'desc' },
      take: ACTIVITY_CLASSIFICATION_CONTEXT_LIMIT,
    });

    logger.debug('[ActivityClassification] Previous messages fetched', {
      userId,
      conversationId: message.conversationId,
      count: previous.length,
    });

    const senderNameMap = await this.getUserNameMap(
      [...new Set(previous.map(prevMessage => prevMessage.senderId))]
    );

    return previous
      .reverse()
      .map(prevMessage => ({
        senderName: senderNameMap.get(prevMessage.senderId) || null,
        contentText: generatePlainTextContent(prevMessage.content || ''),
        createdAt: prevMessage.createdAt.getTime(),
      }));
  }

  private async getThreadContext(
    userId: string | null,
    message: { conversationId: string; messageId: string; createdAt: Date; senderId: string },
    initialMessageId: string | null
  ): Promise<ThreadContextResult> {
    logger.debug('[ActivityClassification] Fetching thread context', {
      userId,
      conversationId: message.conversationId,
      initialMessageId,
    });
    const visibilityFilter = userId
      ? { OR: [{ visibleTo: null }, { visibleTo: userId }] }
      : { visibleTo: null };
    const [initialMessage, threadMessages] = await Promise.all([
      initialMessageId
        ? db.message.findUnique({ where: { messageId: initialMessageId } })
        : Promise.resolve(null),
      db.message.findMany({
        where: {
          conversationId: message.conversationId,
          ...visibilityFilter,
        },
        orderBy: { createdAt: 'desc' },
        take: ACTIVITY_CLASSIFICATION_THREAD_LIMIT,
      }),
    ]);

    logger.debug('[ActivityClassification] Thread messages fetched', {
      userId,
      conversationId: message.conversationId,
      totalThreadMessages: threadMessages.length,
    });

    const filteredThreadMessages = threadMessages
      .filter(threadMessage => threadMessage.messageId !== message.messageId)
      .filter(threadMessage => threadMessage.messageId !== initialMessageId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const indexCandidates = [
      ...(initialMessage ? [initialMessage] : []),
      ...filteredThreadMessages,
      message,
    ];

    const uniqueIndexCandidates = new Map(
      indexCandidates.map(item => [item.messageId, item])
    );

    const orderedIndexCandidates = [...uniqueIndexCandidates.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );

    const threadIndexMap = new Map<string, number>();
    orderedIndexCandidates.forEach((item, index) => {
      threadIndexMap.set(item.messageId, index);
    });

    const senderIds = [
      ...new Set([
        ...(initialMessage ? [initialMessage.senderId] : []),
        ...filteredThreadMessages.map(threadMessage => threadMessage.senderId),
      ]),
    ];
    const senderNameMap = await this.getUserNameMap(senderIds);

    const threadContext = {
      initialMessage: initialMessage
        ? {
            senderName: senderNameMap.get(initialMessage.senderId) || null,
            contentText: generatePlainTextContent(initialMessage.content || ''),
            createdAt: initialMessage.createdAt.getTime(),
            threadIndex: threadIndexMap.get(initialMessage.messageId) ?? null,
          }
        : null,
      messages: filteredThreadMessages.map(threadMessage => ({
        senderName: senderNameMap.get(threadMessage.senderId) || null,
        contentText: generatePlainTextContent(threadMessage.content || ''),
        createdAt: threadMessage.createdAt.getTime(),
        threadIndex: threadIndexMap.get(threadMessage.messageId) ?? null,
      })),
    };

    return {
      threadContext,
      currentMessageIndex: threadIndexMap.get(message.messageId) ?? null,
    };
  }

  private async getUserNameMap(userIds: string[]): Promise<Map<string, string>> {
    const uniqueUserIds = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    if (uniqueUserIds.length === 0) return new Map();

    const users = await db.user.findMany({
      where: { id: { in: uniqueUserIds } },
      select: { id: true, name: true },
    });

    return new Map(users.map(user => [user.id, user.name]));
  }

  private async getGroupMemberSummaries(groupIds: string[]): Promise<Map<string, GroupMemberSummary>> {
    const uniqueGroupIds = [...new Set(groupIds.filter((id): id is string => Boolean(id)))];
    if (uniqueGroupIds.length === 0) return new Map();

    const groupCounts = await db.userGroupMapping.groupBy({
      by: ['userGroupId'],
      where: { userGroupId: { in: uniqueGroupIds } },
      _count: { userGroupId: true },
    });
    const countMap = new Map(
      groupCounts.map(entry => [entry.userGroupId, entry._count.userGroupId])
    );

    const summaryMap = new Map<string, GroupMemberSummary>();

    await Promise.all(
      uniqueGroupIds.map(async groupId => {
        const mappings = await db.userGroupMapping.findMany({
          where: { userGroupId: groupId },
          select: { userId: true },
          take: GROUP_MEMBER_LIMIT,
          orderBy: { createdAt: 'asc' },
        });

        const userNameMap = await this.getUserNameMap(mappings.map(mapping => mapping.userId));
        const members = mappings
          .map(mapping => userNameMap.get(mapping.userId))
          .filter((name): name is string => Boolean(name));

        summaryMap.set(groupId, {
          memberCount: countMap.get(groupId) ?? 0,
          members,
        });
      })
    );

    return summaryMap;
  }

  private async getMessageAttachmentSummary(
    message: { messageId: string; hasAttachment: boolean },
    contentHtml: string,
    contentText: string
  ): Promise<{ imageCount: number; fileCount: number; linkCount: number }> {
    const attachments = message.hasAttachment
      ? await repositories.messageAttachments.findByMessageId(message.messageId)
      : [];

    let imageCount = 0;
    let fileCount = 0;

    for (const attachment of attachments) {
      const mimetype = attachment.mimetype?.toLowerCase() || '';
      if (mimetype.startsWith('image/')) {
        imageCount += 1;
      } else {
        fileCount += 1;
      }
    }

    const linkCount = this.getLinkCount(contentHtml, contentText);

    return { imageCount, fileCount, linkCount };
  }

  private getLinkCount(contentHtml: string, contentText: string): number {
    const links = new Set<string>();

    if (contentHtml) {
      const hrefRegex = /<a\s+[^>]*href=(\"|')([^\"']+)\1/gi;
      let match: RegExpExecArray | null;
      while ((match = hrefRegex.exec(contentHtml)) !== null) {
        if (match[2]) {
          links.add(match[2]);
        }
      }
    }

    if (contentText) {
      const urlRegex = /\bhttps?:\/\/[^\s<>"')]+/gi;
      const wwwRegex = /\bwww\.[^\s<>"')]+/gi;
      const urlMatches = contentText.match(urlRegex) || [];
      const wwwMatches = contentText.match(wwwRegex) || [];
      for (const url of urlMatches) {
        links.add(url);
      }
      for (const url of wwwMatches) {
        links.add(url);
      }
    }

    return links.size;
  }

  private mapClassification(
    classification: 'ACTIONABLE' | 'FYI' | 'SKIP',
    actorAction: string
  ): ActivityClassification {
    if (classification === 'SKIP' && actorAction !== 'direct_message') {
      logger.warn('[ActivityClassification] SKIP returned for non-direct message, coercing to FYI', {
        actorAction,
      });
      return ActivityClassification.FYI;
    }

    switch (classification) {
      case 'ACTIONABLE':
        return ActivityClassification.ACTIONABLE;
      case 'FYI':
        return ActivityClassification.FYI;
      case 'SKIP':
        return ActivityClassification.SKIP;
      default:
        return ActivityClassification.FYI;
    }
  }

  private async updateClassification(
    activityId: string,
    classification: ActivityClassification,
    confidence: number | null
  ): Promise<void> {
    if (classification === ActivityClassification.SKIP) {
      logger.debug('[ActivityClassification] Deleting skipped activity', { activityId });
      await db.activity.deleteMany({ where: { id: activityId } });
      return;
    }
    logger.debug('[ActivityClassification] Persisting classification', {
      activityId,
      classification,
      confidence,
    });
    await db.activity.update({
      where: { id: activityId },
      data: {
        classification,
        classificationConfidence: confidence,
        classificationJobType: null,
      },
    });
    logger.debug('[ActivityClassification] Classification persisted', {
      activityId,
      classification,
      confidence,
    });
  }

  private async updateClassificationAudience(
    activityIds: string[],
    classification: ActivityClassification,
    confidence: number | null
  ): Promise<void> {
    if (activityIds.length === 0) return;
    logger.debug('[ActivityClassification] Persisting audience classification', {
      activityCount: activityIds.length,
      classification,
      confidence,
    });
    await db.activity.updateMany({
      where: { id: { in: activityIds } },
      data: {
        classification,
        classificationConfidence: confidence,
        classificationJobType: null,
      },
    });
    logger.debug('[ActivityClassification] Audience classification persisted', {
      activityCount: activityIds.length,
      classification,
      confidence,
    });
  }

}

export const activityClassificationService = new ActivityClassificationService();
