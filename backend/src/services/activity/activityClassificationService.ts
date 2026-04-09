import { z } from 'zod';
import { Activity, ActivityClassification } from '@prisma/client';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { extractAllMentions } from '@/utils/mentionParser';
import { extractSpecialMentions } from '@/utils/mentionUtils';
import { generatePlainTextContent } from '@/utils/contentUtils';
import { logger } from '@/utils/logger';
import {
  getActivityClassificationPrompt,
  type ActivityClassificationPromptResult,
} from '@/services/activity/activityClassificationLangfusePrompts';
import { config as envConfig } from '@/config/env';
import { LLMClient, createUserMessage } from 'agentic-framework';
import type { LLMClientConfig } from 'agentic-framework';

const ACTIVITY_CLASSIFICATION_REQUEST_MAX_ATTEMPTS = 3;
const ACTIVITY_CLASSIFICATION_RETRY_BASE_DELAY_MS = 1000;
const ACTIVITY_CLASSIFICATION_RETRY_MAX_DELAY_MS = 30000;

export const ACTIVITY_CLASSIFICATION_MODEL =
  envConfig.activityClassification?.model ?? 'glm-latest';
const LANGFUSE_PROMPT_LABEL = 'production';
const LANGFUSE_PROMPT_NAMES = {
  direct_message: 'activityDMPrompt',
  mention: 'activityGeneralPrompt',
  audience: 'activityGeneralPrompt',
} as const;
const ACTIVITY_CLASSIFICATION_CONTEXT_LIMIT = 0;
const ACTIVITY_CLASSIFICATION_THREAD_LIMIT = 10;
const GROUP_MEMBER_LIMIT = 10;

const ActivityClassificationOutputSchema = z.object({
  classification: z.enum(['ACTIONABLE', 'FYI', 'SKIP']),
  confidence: z.coerce.number().min(0).max(1).optional(),
});

type ActivityClassificationOutput = z.infer<typeof ActivityClassificationOutputSchema>;

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
  // private readonly model = 'glm-46-fp8';
  private readonly model = ACTIVITY_CLASSIFICATION_MODEL;
  private llmClient: LLMClient | null = null;

  private getLLMClient(): LLMClient {
    if (!this.llmClient) {
      const llmConfig: LLMClientConfig = {
        provider: {
          type: 'litellm',
          config: {
            apiKey: envConfig.activityClassification.litellmApiKey,
            baseUrl: envConfig.litellm.baseUrl,
            timeout: envConfig.llm?.requestTimeoutMs,
            customHeaders: {
              'x-litellm-disable-logging': 'true',
            },
          },
        },
        defaultModel: this.model,
        temperature: 0.2,
        retry: {
          maxAttempts: ACTIVITY_CLASSIFICATION_REQUEST_MAX_ATTEMPTS,
          baseDelay: ACTIVITY_CLASSIFICATION_RETRY_BASE_DELAY_MS,
          maxDelay: ACTIVITY_CLASSIFICATION_RETRY_MAX_DELAY_MS,
          exponentialBackoff: true,
        },
      };
      this.llmClient = new LLMClient(llmConfig);
    }
    return this.llmClient;
  }

  async classifyActivity(activityId: string): Promise<{
    status: 'classified' | 'pending' | 'error' | 'skipped';
    classification?: ActivityClassification;
    confidence?: number | null;
    usedLLM?: boolean;
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
        ActivityClassification.PROCESSING,
      ]);
      if (!pendingStates.has(activity.classification)) {
        logger.debug('[ActivityClassification] Activity already classified, skipping', {
          activityId,
          classification: activity.classification,
        });
        return {
          status: 'skipped',
          reason: 'already_classified',
          classification: activity.classification,
        };
      }
    }

    if (activity.actionSource !== 'message') {
      await this.updateClassification(activity.id, ActivityClassification.FYI, null);
      return {
        status: 'classified',
        classification: ActivityClassification.FYI,
        confidence: null,
        usedLLM: false,
      };
    }

    if (!envConfig.activityClassification.litellmApiKey) {
      logger.warn('[ActivityClassification] ACTIVITY_CLASSIFICATION_LITELLM_API_KEY is not set. Skipping classification.', {
        activityId,
      });
      return { status: 'pending', usedLLM: false, reason: 'llm_unavailable' };
    }

    logger.debug('[ActivityClassification] Building classification input', { activityId });
    const inputPayload = await this.buildClassificationInput(activity);
    if (!inputPayload) {
      logger.error('[ActivityClassification] Failed to build classification input', { activityId });
      await this.updateClassification(activity.id, ActivityClassification.ERROR, null);
      return { status: 'error', usedLLM: false, reason: 'input_build_failed' };
    }

    const promptType =
      inputPayload.actorAction === 'direct_message' ? 'direct_message' : 'mention';
    const promptName = LANGFUSE_PROMPT_NAMES[promptType];
    const inputJson = JSON.stringify(inputPayload, null, 2);
    let promptResult: ActivityClassificationPromptResult;
    try {
      promptResult = await getActivityClassificationPrompt({
        name: promptName,
        label: LANGFUSE_PROMPT_LABEL,
        templateVariables: { INPUT_JSON: inputJson },
      });
    } catch (error) {
      logger.error('[ActivityClassification] Failed to resolve Langfuse prompt', {
        activityId,
        promptType,
        promptName,
        promptLabel: LANGFUSE_PROMPT_LABEL,
        errorMessage: error instanceof Error ? error.message : String(error ?? 'unknown error'),
      });
      await this.updateClassification(activity.id, ActivityClassification.ERROR, null);
      return { status: 'error', usedLLM: false, reason: 'prompt_fetch_failed' };
    }

    const prompt = promptResult.prompt;
    logger.debug('[ActivityClassification] Prompt resolved', {
      activityId,
      promptType,
      promptName,
      promptLabel: LANGFUSE_PROMPT_LABEL,
    });

    try {
      logger.info('[ActivityClassification] Sending request to LLM', {
        activityId,
        model: this.model,
      });
      const llmResponse = await this.getLLMClient().generate({
        messages: [createUserMessage(prompt)],
        model: this.model,
      });
      const responseContent = llmResponse.content;

      const parsed = this.parseLLMResponse(responseContent);
      if (!parsed) {
        logger.error('[ActivityClassification] Failed to parse LLM response', {
          activityId,
          response: responseContent,
        });
        await this.updateClassification(activity.id, ActivityClassification.ERROR, null);
        return { status: 'error', usedLLM: true, reason: 'parse_failed' };
      }

      const mappedClassification = this.mapClassification(
        parsed.classification,
        activity.actorAction
      );

      const confidence = parsed.confidence ?? null;

      logger.info('[ActivityClassification] Classification parsed', {
        activityId,
        classification: mappedClassification,
        confidence,
        rawClassification: parsed.classification,
      });
      await this.updateClassification(activity.id, mappedClassification, confidence);
      return {
        status: 'classified',
        classification: mappedClassification,
        confidence,
        usedLLM: true,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error ?? 'unknown error'));
      logger.error('[ActivityClassification] LLM classification failed', {
        activityId,
        errorMessage: err.message,
        errorStack: err.stack,
      });
      // Leave as PENDING for retry
      return { status: 'pending', usedLLM: true, reason: 'llm_failed' };
    }
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
    usedLLM?: boolean;
    reason?: string;
  }> {
    const { activityIds, messageId, channelId, recipientUserIds } = params;
    if (activityIds.length === 0 || recipientUserIds.length === 0) {
      return { status: 'skipped', reason: 'empty_audience' };
    }

    if (!envConfig.activityClassification.litellmApiKey) {
      logger.warn('[ActivityClassification] ACTIVITY_CLASSIFICATION_LITELLM_API_KEY is not set. Skipping audience classification.', {
        messageId,
        channelId,
        activityCount: activityIds.length,
      });
      return { status: 'pending', usedLLM: false, reason: 'llm_unavailable' };
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
      return { status: 'error', usedLLM: false, reason: 'input_build_failed' };
    }

    const promptType = 'audience';
    const promptName = LANGFUSE_PROMPT_NAMES[promptType];
    const inputJson = JSON.stringify(inputPayload, null, 2);
    let promptResult: ActivityClassificationPromptResult;
    try {
      promptResult = await getActivityClassificationPrompt({
        name: promptName,
        label: LANGFUSE_PROMPT_LABEL,
        templateVariables: { INPUT_JSON: inputJson },
      });
    } catch (error) {
      logger.error('[ActivityClassification] Failed to resolve audience Langfuse prompt', {
        messageId,
        promptType,
        promptName,
        promptLabel: LANGFUSE_PROMPT_LABEL,
        errorMessage: error instanceof Error ? error.message : String(error ?? 'unknown error'),
      });
      await this.updateClassificationAudience(activityIds, ActivityClassification.ERROR, null);
      return { status: 'error', usedLLM: false, reason: 'prompt_fetch_failed' };
    }

    const prompt = promptResult.prompt;
    logger.debug('[ActivityClassification] Audience prompt resolved', {
      messageId,
      promptType,
      promptName,
      promptLabel: LANGFUSE_PROMPT_LABEL,
    });

    try {
      logger.info('[ActivityClassification] Sending audience request to LLM', {
        messageId,
        model: this.model,
      });
      const llmResponse = await this.getLLMClient().generate({
        messages: [createUserMessage(prompt)],
        model: this.model,
      });
      const responseContent = llmResponse.content;

      const parsed = this.parseLLMResponse(responseContent);
      if (!parsed) {
        logger.error('[ActivityClassification] Failed to parse audience LLM response', {
          messageId,
          response: responseContent,
        });
        await this.updateClassificationAudience(activityIds, ActivityClassification.ERROR, null);
        return { status: 'error', usedLLM: true, reason: 'parse_failed' };
      }

      const mappedClassification = this.mapClassification(
        parsed.classification,
        inputPayload.actorAction
      );

      const confidence = parsed.confidence ?? null;

      logger.info('[ActivityClassification] Audience classification parsed', {
        messageId,
        classification: mappedClassification,
        confidence,
      });
      await this.updateClassificationAudience(activityIds, mappedClassification, confidence);
      return {
        status: 'classified',
        classification: mappedClassification,
        confidence,
        usedLLM: true,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error ?? 'unknown error'));
      logger.error('[ActivityClassification] Audience LLM classification failed', {
        messageId,
        errorMessage: err.message,
        errorStack: err.stack,
      });
      // Leave as PENDING for retry
      return { status: 'pending', usedLLM: true, reason: 'llm_failed' };
    }
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

  private parseLLMResponse(content?: string | null): ActivityClassificationOutput | null {
    logger.debug('[ActivityClassification] Parsing LLM response');
    if (!content) return null;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const normalized =
        typeof parsed?.classification === 'string'
          ? { ...parsed, classification: parsed.classification.toUpperCase() }
          : parsed;

      let normalizedConfidence = normalized?.confidence;
      if (normalizedConfidence === null) {
        normalizedConfidence = undefined;
      }
      if (typeof normalizedConfidence === 'string') {
        const parsedValue = Number(normalizedConfidence);
        if (!Number.isNaN(parsedValue)) {
          normalizedConfidence = parsedValue;
        }
      }
      if (typeof normalizedConfidence === 'number' && normalizedConfidence > 1) {
        normalizedConfidence = normalizedConfidence / 100;
      }

      const result = ActivityClassificationOutputSchema.safeParse({
        ...normalized,
        confidence: normalizedConfidence,
      });

      if (!result.success) {
        logger.warn('[ActivityClassification] LLM response validation failed', {
          issues: result.error.issues,
        });
        return null;
      }

      return result.data;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error ?? 'unknown error'));
      logger.error('[ActivityClassification] Failed to parse LLM response', {
        errorMessage: err.message,
        errorStack: err.stack,
      });
      return null;
    }
  }

  private mapClassification(
    classification: ActivityClassificationOutput['classification'],
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
