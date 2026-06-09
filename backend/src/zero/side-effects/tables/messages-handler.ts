import { v4 as uuidv4 } from 'uuid';
import { ActivityClassification, ActivityClassificationJobType, AttachmentEntityType, ChannelScopeType, NotificationDeliveryMethod, NotificationType, UserType } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, MessagePreviousValue } from '../types';
import { db } from '@/database/client';
import { config } from '@/config/env';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { slackService } from '@/services/slackService';
import { handleUnreadCount } from '@/zero/utils/unreadCountUtlis';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { isSupportedMimeType } from '@/services/fileProcessor';
import {
  extractAllUsersForNotification,
  getChannelParticipantsForMention,
  getOnlineChannelParticipants,
  extractSpecialMentions,
} from '@/utils/mentionUtils';
import { createDirectMessageActivities } from '@/utils/messageActivityUtils';
import { userActivityTrackingService } from '@/services/userActivityTrackingService';
import { logger } from '@/utils/logger';
import { emitMessageReceived } from '@/automations/triggers/message-received.trigger';
import { activityTrackingService } from '@/services/activityTrackingService';
import { Platform, serializeMessagePreviewMd, serializeLinkPreviewMd, parseLinkPreviewMd, parseForwardedMessageXml, type MessagePreviewData, type TicketPreviewSnapshot } from '@xyne/shared';
import { handleEventSubscriptionsForUsers } from '@/apps/core/eventSubscriptionUtils';
import { BaseAppEvent, AppEventType, AppMentionEventPayload, DMEventPayload, UserMentionedEventPayload } from '@/apps/types';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { extractInternalUrl, parseInternalUrl, extractFirstUrl } from '@/utils/urlUtils';
import { linkPreviewService, type ExternalLinkMetadata } from '@/services/linkPreviewService';
import { botCatalog } from '@/bots/unified/catalog/bot-catalog';
import { extractBotMentions, executeBotForMention, CHAT_ENABLED_BOT_IDS } from '@/services/bots';
import { getSlackRecipientEmails } from '@/utils/notificationHelper';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import type { BotDefinition } from '@/bots/unified/types/unified-bot';
import { messageMetadataService } from '@/services/messageMetadataService';
import { prefetchFilterData, type PrefetchedFilterData } from '@/services/notificationFilterService';

const LARGE_GROUP_DM_THRESHOLD = 8;
const messageAttachmentRepository = new MessageAttachmentRepository();
const channelRepository = new ChannelRepository();

/**
 * Extract plaintext content strings from a FlowJSON payload for notification
 * preview and mention scanning.
 *
 * FlowJSON is stored as `<div data-flow-json="...escaped JSON...">Flow JSON</div>`.
 * The visible text node ("Flow JSON") is meaningless — we need to walk the
 * component tree and collect every text `content` prop, then join them.
 */
function extractTextFromFlowJson(content: string): string {
  const attrMatch = content.match(/data-flow-json="([^"]+)"/);
  if (!attrMatch) return '';
  try {
    const json = attrMatch[1]
      .replace(/&quot;/g, '"')
      .replace(/&#10;/g, '\n')
      .replace(/&#13;/g, '\r');
    const flow = JSON.parse(json) as { components?: unknown[] };

    const texts: string[] = [];

    function walk(components: unknown[]): void {
      for (const comp of components) {
        if (!comp || typeof comp !== 'object') continue;
        const c = comp as Record<string, unknown>;
        if (c['props'] && typeof c['props'] === 'object') {
          const p = c['props'] as Record<string, unknown>;
          if (typeof p['content'] === 'string' && p['content'].trim()) {
            texts.push(p['content'].trim());
          }
        }
        if (Array.isArray(c['children'])) {
          walk(c['children'] as unknown[]);
        }
      }
    }

    if (Array.isArray(flow.components)) {
      walk(flow.components);
    }
    return texts.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

/**
 * Like extractTextFromFlowJson but strips mrkdwn tokens for display in
 * notification previews (user mentions removed, broadcast → @channel, etc.).
 */
function extractCleanTextFromFlowJson(content: string): string {
  const raw = extractTextFromFlowJson(content);
  if (!raw) return '';
  return raw
    .replace(/<userid:[^>]+>/g, '')
    .replace(/<channelid:[^>]+>/g, '#channel')
    .replace(/<broadcast:channel>/gi, '@channel ')
    .replace(/<broadcast:here>/gi, '@here ')
    .replace(/<broadcast:([^>]+)>/gi, '@$1')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/\s+/g, ' ').trim();
}

/**
 * For flow JSON messages, returns the extracted plaintext from the FlowJSON
 * component tree (suitable for mention scanning and notification preview).
 * Returns null for non-flow-json content.
 */
function getFlowJsonContentForNotification(content: string): string | null {
  if (!content.includes('data-flow-json')) return null;
  return extractCleanTextFromFlowJson(content) || null;
}

/** Returns raw FlowJSON text with tokens intact (for mention scanning). */
function getFlowJsonRawTextForMentions(content: string): string | null {
  if (!content.includes('data-flow-json')) return null;
  return extractTextFromFlowJson(content) || null;
}

function getNotificationPreviewContent(content: string, msgType: string, hasAttachment: boolean): string {
  let cleanContent = '';

  if (msgType === 'FORWARDED') {
    const forwardedMessage = parseForwardedMessageXml(content);
    if (forwardedMessage) {
      const notePreview = forwardedMessage.optionalText
        ? getPlainTextNotificationContent(forwardedMessage.optionalText)
        : '';
      const forwardedPreview = getPlainTextNotificationContent(forwardedMessage.content);
      const forwardedSummary = forwardedPreview
        ? `Forwarded from ${forwardedMessage.originalSenderName}: ${forwardedPreview}`
        : `Forwarded a message from ${forwardedMessage.originalSenderName}`;

      cleanContent = [notePreview, forwardedSummary]
        .filter(Boolean)
        .join(' ');
    }
  }

  if (!cleanContent) {
    // For flow JSON messages, extract text from the component tree instead of
    // parsing HTML (which only sees the literal "Flow JSON" text node).
    const flowText = getFlowJsonContentForNotification(content);
    cleanContent = flowText ?? getPlainTextNotificationContent(content);
  }

  if (!cleanContent && hasAttachment) {
    return msgType === 'FORWARDED' ? 'Forwarded an attachment' : 'Sent an attachment';
  }

  return cleanContent;
}

function getPlainTextNotificationContent(content: string): string {
  return extractPlainTextFromHtml(content).replace(/\s+/g, ' ').trim();
}

function formatDmChannelName(names: string[], maxVisible: number = 2): string {
  const visible = names.slice(0, maxVisible);
  const remainder = names.length - visible.length;
  if (remainder === 0) {
    return visible.join(', ');
  }
  const suffix = remainder === 1 ? 'and 1 other' : `and ${remainder} others`;
  return `${visible.join(', ')} ${suffix}`;
}

export class MessagesSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const { entityId: messageId } = job;

    logger.info('[SIDE-EFFECT] Message insert side effect triggered', { messageId });

    const message = await db.message.findUnique({
      where: { messageId },
      select: {
        messageId: true,
        senderId: true,
        content: true,
        conversationId: true,
        msgType: true,
        hasAttachment: true,
        createdAt: true
      },
    });

    if (!message || message.msgType === "SYSTEM" ) {
      return;
    }

    // Resolve link preview asynchronously (fire-and-forget)
    // Tries internal app link first, then external OG preview
    if (message.content && message.msgType === 'USER') {
      this.resolveLinkPreview(message.messageId, message.conversationId, message.content).catch(error => {
        logger.error('[MessagesSideEffect] Failed to resolve link preview:', {
          messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    const conversation = await db.conversation.findUnique({
      where: { conversationId: message.conversationId },
      select: {
        channelId: true,
        initialMessageId: true
      },
    });

    userActivityTrackingService.trackMessageSent(this.ctx.userID, {
      messageId,
      hasAttachment: message.hasAttachment,
    }).catch(error => {
      logger.error('[UserActivityTracking] Failed to track message sent activity:', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    if (!conversation?.channelId) {
      return;
    }

    const { senderId, content, conversationId } = message;
    const { channelId } = conversation;

    if (conversation.initialMessageId === message.messageId) {
      void emitMessageReceived({
        messageId: message.messageId,
        conversationId,
        channelId,
        msgType: message.msgType,
        userId: senderId,
      });
    }

    const [channel, sender, channelParticipantsRaw, userPreference] = await Promise.all([
      db.channel.findUnique({
        where: { id: channelId },
        select: { name: true, scopeType: true, projectId: true }
      }),
      db.user.findUnique({
        where: { id: senderId },
        select: { name: true, userType: true, picture: true }
      }),
      db.channelParticipant.findMany({
        where: { channelId },
        select: { userId: true }
      }),
      db.userPreference.findUnique({
        where: { userId: senderId },
        select: { allowThreadBroadcastMentions: true },
      }),
    ]);

    const channelProject = channel?.projectId
      ? await db.project.findUnique({
          where: { id: channel.projectId },
          select: { name: true },
        })
      : null;

    const participantUserIds = channelParticipantsRaw.map(p => p.userId);
    const users = await db.user.findMany({
      where: { id: { in: participantUserIds } },
      select: { id: true, email: true, name: true, userType: true }
    });
    const appUserIds = users.filter(u => u.userType === UserType.APP).map(u => u.id);

    const userMap = new Map(users.map(u => [u.id, u]));
    const channelParticipants = channelParticipantsRaw.map(p => ({
      userId: p.userId,
      user: {
        email: userMap.get(p.userId)?.email || '',
        name: userMap.get(p.userId)?.name || ''
      }
    }));

    const channelName = channel?.name || 'Unknown Channel';
    const senderName = sender?.name || 'Someone';
    const cleanContent = getNotificationPreviewContent(content, message.msgType, message.hasAttachment);
    const isDMChannel = channel?.scopeType === ChannelScopeType.DM || channel?.scopeType === ChannelScopeType.GROUP_DM;
    const isOneToOneDM = channel?.scopeType === ChannelScopeType.DM;
    const isReply = conversation.initialMessageId && conversation.initialMessageId !== messageId;
    const allowThreadBroadcastMentions = userPreference?.allowThreadBroadcastMentions ?? false;

    // For FlowJSON, scan raw flow text (tokens intact) not the HTML wrapper.
    const flowRawText = getFlowJsonRawTextForMentions(content);
    const contentForMentions = flowRawText ?? content;
    const specialMentions =
      isReply && !allowThreadBroadcastMentions
        ? { hasChannel: false, hasHere: false }
        : extractSpecialMentions(contentForMentions);
    const mentionType = specialMentions.hasChannel ? '@channel' : specialMentions.hasHere ? '@here' : undefined;

    if (channel?.projectId && !isDMChannel) {
      // Emit a synthetic MESSAGE/SENT activity event.
      // This flows through activityTrackingService -> nudge framework.
      // Fires for both parent messages and replies to enable link-paste detection.
      void activityTrackingService.saveActivityEvent({
        user_id: senderId,
        session_id: `side-effect-${messageId}`,
        event_category: 'MESSAGE',
        event_name: 'SENT',
        url: '',
        trigger_type: 'SYSTEM',
        platform: Platform.WEB,
        timestamp: Date.now(),
        context_metadata: {
          messageId,
          conversationId,
          channelId,
          projectId: channel.projectId,
          senderId,
        },
      });

      // Emit MESSAGE.FORWARDED for forwarded messages
      if (message.msgType === 'FORWARDED') {
        let originalMessageId: string | undefined;
        try {
          const { parseForwardedMessageXml } = await import('@xyne/shared');
          const parsed = parseForwardedMessageXml(message.content || '');
          originalMessageId = parsed?.originalMessageId;
        } catch {
          // Fallback: try regex extraction
          const idMatch = (message.content || '').match(
            /<OriginalMessageId>([^<]+)<\/OriginalMessageId>/,
          );
          originalMessageId = idMatch?.[1];
        }

        if (originalMessageId) {
          void activityTrackingService.saveActivityEvent({
            user_id: senderId,
            session_id: `side-effect-${messageId}`,
            event_category: 'MESSAGE',
            event_name: 'FORWARDED',
            url: '',
            trigger_type: 'SYSTEM',
            platform: Platform.WEB,
            timestamp: Date.now(),
            context_metadata: {
              messageId,
              originalMessageId,
              conversationId,
              channelId,
              projectId: channel.projectId,
              senderId,
            },
          });
        }
      }
    }

    if (isDMChannel && channel) {
      const memberNames = channelParticipants
        .filter(p => channel.scopeType === 'DM' ? p.userId !== senderId : true)
        .map(p => p.user.name || 'Unknown');
      const dmChannelName = formatDmChannelName(memberNames);

      const dmPrefetchedData = channelParticipants.length > 0
        ? await prefetchFilterData(channelParticipants.map(p => p.userId), channelId)
        : undefined;

      await this.handleDMChannelMessage(
        messageId,
        conversationId,
        channelId,
        senderId,
        appUserIds,
        dmChannelName || 'Direct Message',
        senderName,
        sender?.picture ?? '',
        cleanContent,
        content,
        conversation.initialMessageId,
        channelParticipants,
        mentionType,
        message.createdAt,
        channel.scopeType,
        message.hasAttachment,
        dmPrefetchedData,
      );
      return;
    }

    const workspaceId = await channelRepository.getWorkspaceId(channelId);
    // In thread replies, disable @channel/@here expansion by not passing channelId.
    // contentForMentions is already computed above (flow text for FlowJSON, raw HTML otherwise)
    const mentionedUsers = await extractAllUsersForNotification(
      contentForMentions,
      workspaceId,
      isReply && !allowThreadBroadcastMentions ? undefined : channelId
    );
    const channelParticipantIds = new Set(channelParticipants.map(p => p.userId));

    const validMentionedUsers = mentionedUsers
      .filter(u => u.mentionSource === 'direct' || u.mentionSource === 'group')
      .filter(user => channelParticipantIds.has(user.userId) && user.userId !== senderId)
      .map(u => ({
        userId: u.userId,
        mentionSource: u.mentionSource
      }))

    const mentionedAppUsersIds = validMentionedUsers.filter(u => appUserIds.includes(u.userId)).map(u => u.userId);

    if (mentionedAppUsersIds.length > 0) {
      const attachments = message.hasAttachment
        ? await messageAttachmentRepository.findByMessageId(messageId)
        : [];

      void this.handlleMessageAppEvents(AppEventType.APP_MENTION, {
        conversationId,
        messageId,
        content: content,
        cleanContent: cleanContent,
        createdAt: message.createdAt,
        userId: senderId,
        senderName,
        channelId,
        channelName: channel?.name ?? channelId,
        ...(channel?.projectId ? { projectId: channel.projectId } : {}),
        ...(channelProject?.name ? { projectName: channelProject.name } : {}),
        ...(attachments.length > 0 && {
          attachments: attachments.map(att => ({
            attachmentId: att.id,
            fileName: att.originalFilename,
            fileSize: att.size,
            mimeType: att.mimetype,
            fileUrl: att.url,
          })),
        }),
      }, mentionedAppUsersIds);
    }

    // Notify app users in the channel when any user is mentioned
    const nonAppMentionedUserIds = validMentionedUsers
      .filter(u => !appUserIds.includes(u.userId))
      .map(u => u.userId);
    const observerAppUserIds = appUserIds.filter(id => !mentionedAppUsersIds.includes(id) && id !== senderId);

    if (nonAppMentionedUserIds.length > 0 && observerAppUserIds.length > 0) {
      void this.handlleMessageAppEvents(AppEventType.USER_MENTIONED, {
        conversationId,
        messageId,
        content: content,
        cleanContent: cleanContent,
        createdAt: message.createdAt,
        userId: senderId,
        senderName,
        channelId,
        channelName: channel?.name ?? channelId,
        ...(channel?.projectId ? { projectId: channel.projectId } : {}),
        ...(channelProject?.name ? { projectName: channelProject.name } : {}),
        mentionedUserIds: nonAppMentionedUserIds,
      }, observerAppUserIds);
    }
    
    const finalMentionedUserIds = validMentionedUsers
      .map(user => user.userId);

    const notificationUserIds = [
      ...new Set(
        mentionedUsers
          .map(u => u.userId)
          .filter(
            userId =>
              channelParticipantIds.has(userId) &&
              userId !== senderId
          )
      ),
    ];

    if (validMentionedUsers.length > 0) {
      const isThreadActivity = conversation.initialMessageId !== messageId;
      const activities = validMentionedUsers.map(user => ({
        id: uuidv4(),
        userId: user.userId,
        actorId: senderId,
        actorAction: user.mentionSource === 'direct' ? 'mentioned_user' as const : 'group_mention' as const,
        // Dual-write: populate both old and new columns
        actionSource: 'message' as const,
        actionSourceId: messageId,
        messageId: messageId,
        channelId,
        isThreadActivity,
        classification: ActivityClassification.PENDING,
      }));

      await activityService.createActivities(activities);
    }

    // Uses isReply calculated earlier for thread context in notifications
    const mentionedUserIdSet = new Set(notificationUserIds);

    // Pre-fetch channelUserStatus + userPresence + userPreference once for all
    // channel participants. All notification calls below operate on disjoint subsets
    // of channelParticipants, so this single round-trip replaces N×3 sequential fetches.
    const prefetchedData = channelParticipants.length > 0
      ? await prefetchFilterData(channelParticipants.map(p => p.userId), channelId)
      : undefined;

    if (!isReply) {
      const channelMessageRecipientIds = channelParticipants
        .map(participant => participant.userId)
        .filter(userId => userId !== senderId && !mentionedUserIdSet.has(userId));

      if (channelMessageRecipientIds.length > 0) {
        try {
          await notificationService.createChannelMessageNotifications(
            channelMessageRecipientIds,
            messageId,
            conversationId,
            channelId,
            channelName,
            senderId,
            senderName,
            cleanContent,
            this.ctx.workspaceId,
            sender?.picture ?? '',
            prefetchedData,
          );
        } catch (error) {
          logger.error('[SIDE-EFFECT] Spaces channel message notifications failed', { error });
        }
      }
    }

    // Track mention-delivered IDs to exclude from thread reply notifications.
    let deliveredMentionUserIds: string[] = [];

    if (notificationUserIds.length > 0) {
      await handleUnreadCount(
        channelId,
        isDMChannel,
        channelParticipants,
        senderId
      );
      const userEmailMap = new Map(
        notificationUserIds
          .map(id => channelParticipants.find(p => p.userId === id))
          .filter(p => p?.user?.email)
          .map(p => [p!.userId, p!.user.email])
      );
      const mentionedEmails = Array.from(userEmailMap.values());

      // Send app notifications first and collect delivered user IDs.
      // On failure, fall back to sending Slack to everyone (fail-open).
      let slackRecipientEmails = mentionedEmails;
      try {
        const { deliveredUserIds } = await notificationService.createMentionNotifications(
          notificationUserIds,
          messageId,
          conversationId,
          channelId,
          channelName,
          senderId,
          senderName,
          cleanContent,
          this.ctx.workspaceId,
          mentionType,
          isOneToOneDM,
          !!isReply,
          sender?.picture ?? '',
          prefetchedData,
        );

        deliveredMentionUserIds = deliveredUserIds;
        slackRecipientEmails = getSlackRecipientEmails(mentionedEmails, deliveredUserIds, userEmailMap);
      } catch (error) {
        logger.error('[SIDE-EFFECT] Spaces mention notifications failed — sending Slack to all recipients', { error });
      }

      await slackService.sendMentionNotifications(
        slackRecipientEmails,
        senderName,
        channelName,
        channelId,
        conversationId,
        messageId,
        mentionType
      );
    }

    await this.handleSpecialMentionActivities(
      channelId,
      messageId,
      senderId,
      mentionType,
      finalMentionedUserIds,
      conversation.initialMessageId !== messageId,
    );

    // Handle bot mentions in channels - trigger bot execution when @mentioned
    await this.handleBotMentions(
      message,
      conversation,
      channel,
      sender,
      channelParticipants
    );

    if (isReply && conversationId) {
      // Exclude already-notified mention recipients from thread replies.
      const replyExcludedUserIds = [
        ...new Set([...finalMentionedUserIds, ...deliveredMentionUserIds]),
      ];
      await this.createReplyActivity(
        conversationId,
        messageId,
        notificationUserIds,
        senderId,
        channelId,
        channelName,
        senderName,
        cleanContent,
        channelParticipants,
        sender?.picture ?? '',
        isOneToOneDM,
        prefetchedData,
        false,
        replyExcludedUserIds,
      );
    }

    // Queue Vespa indexing for message attachments
    await this.queueVespaIndexingForAttachments(messageId);
  }

  /**
   * Resolve link preview for a message: tries internal app link first,
   * falls back to external OG metadata.
   */
  /**
   * Parse any Bitbucket URL and extract relevant information.
   * Supports: PRs, commits, files, repos, branches, and generic Bitbucket links.
   * 
   * Examples:
   * - PR: https://bitbucket.example.com/projects/XYNE/repos/xyne-spaces/pull-requests/2
   * - Commit: https://bitbucket.example.com/projects/XYNE/repos/xyne-spaces/commits/abc123
   * - File: https://bitbucket.example.com/projects/XYNE/repos/xyne-spaces/browse/src/file.ts
   * - Repo: https://bitbucket.example.com/projects/XYNE/repos/xyne-spaces
   */
  private parseBitbucketUrl(url: string): {
    type: 'pr' | 'commit' | 'file' | 'repo' | 'branch' | 'generic';
    project?: string;
    repo?: string;
    prNumber?: number;
    commitHash?: string;
    filePath?: string;
    hostname: string;
    pathname: string;
  } | null {
    try {
      const urlObj = new URL(url);
      
      // Extract Bitbucket domain from config or use default
      const bitbucketDomain = config.bitbucket.baseUrl 
        ? new URL(config.bitbucket.baseUrl).hostname 
        : 'bitbucket.juspay.net';
      
      // Only handle configured Bitbucket domain
      if (!urlObj.hostname.includes(bitbucketDomain)) {
        return null;
      }

      const pathname = urlObj.pathname;
      
      // Try PR pattern: /projects/{PROJECT}/repos/{REPO}/pull-requests/{NUMBER}
      const prMatch = pathname.match(/\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/);
      if (prMatch) {
        return {
          type: 'pr',
          project: prMatch[1],
          repo: prMatch[2],
          prNumber: parseInt(prMatch[3], 10),
          hostname: urlObj.hostname,
          pathname,
        };
      }
      
      // Try commit pattern: /projects/{PROJECT}/repos/{REPO}/commits/{HASH}
      const commitMatch = pathname.match(/\/projects\/([^/]+)\/repos\/([^/]+)\/commits\/([a-f0-9]+)/);
      if (commitMatch) {
        return {
          type: 'commit',
          project: commitMatch[1],
          repo: commitMatch[2],
          commitHash: commitMatch[3],
          hostname: urlObj.hostname,
          pathname,
        };
      }
      
      // Try file/browse pattern: /projects/{PROJECT}/repos/{REPO}/browse/{PATH}
      const fileMatch = pathname.match(/\/projects\/([^/]+)\/repos\/([^/]+)\/browse\/(.+)/);
      if (fileMatch) {
        return {
          type: 'file',
          project: fileMatch[1],
          repo: fileMatch[2],
          filePath: fileMatch[3],
          hostname: urlObj.hostname,
          pathname,
        };
      }
      
      // Try branch pattern: /projects/{PROJECT}/repos/{REPO}/branches
      const branchMatch = pathname.match(/\/projects\/([^/]+)\/repos\/([^/]+)\/branches/);
      if (branchMatch) {
        return {
          type: 'branch',
          project: branchMatch[1],
          repo: branchMatch[2],
          hostname: urlObj.hostname,
          pathname,
        };
      }
      
      // Try repo home pattern: /projects/{PROJECT}/repos/{REPO}
      const repoMatch = pathname.match(/\/projects\/([^/]+)\/repos\/([^/]+)\/?$/);
      if (repoMatch) {
        return {
          type: 'repo',
          project: repoMatch[1],
          repo: repoMatch[2],
          hostname: urlObj.hostname,
          pathname,
        };
      }
      
      // Generic Bitbucket link (project pages, settings, etc.)
      return {
        type: 'generic',
        hostname: urlObj.hostname,
        pathname,
      };
      
    } catch {
      return null;
    }
  }

  /**
   * Extract metadata from Bitbucket API response based on URL type.
   */
  /**
   * Create URL-derived Bitbucket metadata for all link types.
   */
  private createUrlDerivedBitbucketMetadata(
    parsedUrl: ReturnType<typeof this.parseBitbucketUrl>,
    url: string,
  ): ExternalLinkMetadata {
    if (!parsedUrl) {
      return {
        url,
        title: 'Bitbucket',
        description: '',
        siteName: 'Bitbucket',
        favicon: 'https://bitbucket.example.com/favicon.ico',
      };
    }

    let title: string;
    let description: string;
    
    switch (parsedUrl.type) {
      case 'pr':
        title = `Pull Request #${parsedUrl.prNumber}`;
        description = `${parsedUrl.project}/${parsedUrl.repo}`;
        break;
      
      case 'commit':
        title = `Commit ${parsedUrl.commitHash?.slice(0, 7)}`;
        description = `${parsedUrl.project}/${parsedUrl.repo}`;
        break;
      
      case 'file':
        title = parsedUrl.filePath || 'File';
        description = `${parsedUrl.project}/${parsedUrl.repo}`;
        break;
      
      case 'repo':
        title = parsedUrl.repo || 'Repository';
        description = `Project: ${parsedUrl.project}`;
        break;
      
      case 'branch':
        title = 'Branches';
        description = `${parsedUrl.project}/${parsedUrl.repo}`;
        break;
      
      case 'generic':
        title = parsedUrl.pathname.split('/').filter(Boolean).pop() || 'Bitbucket';
        description = 'Bitbucket';
        break;
      
      default:
        title = 'Bitbucket';
        description = '';
    }
    
    return {
      url,
      title,
      description,
      siteName: 'Bitbucket',
      favicon: `https://${parsedUrl.hostname}/favicon.ico`,
    };
  }

  /**
   * Resolve Bitbucket link preview using URL-derived metadata.
   * Supports all Bitbucket link types: PRs, commits, files, repos, branches, and generic links.
   * Extracts context from URL structure to generate preview (title, description, etc.)
   * Returns true if preview was written, false otherwise.
   */
  private async resolveBitbucketLinkPreview(
    messageId: string,
    conversationId: string,
    url: string,
  ): Promise<boolean> {
    const parsedUrl = this.parseBitbucketUrl(url);
    if (!parsedUrl) return false;

    logger.info('[MessagesSideEffect] Detected Bitbucket URL:', {
      url,
      type: parsedUrl.type,
      project: parsedUrl.project,
      repo: parsedUrl.repo,
    });

    // Generate URL-derived metadata
    const metadata = this.createUrlDerivedBitbucketMetadata(parsedUrl, url);

    // Write preview to database
    const md = serializeLinkPreviewMd(metadata);
    if (!md) return false;

    await db.message.update({
      where: { messageId },
      data: { link_preview_md: md },
    });

    await this.syncConversationMessageMetadata(conversationId);

    logger.info(`[MessagesSideEffect] Updated message ${messageId} with Bitbucket ${parsedUrl.type} preview`);
    return true;
  }

  private async resolveLinkPreview(
    messageId: string,
    conversationId: string,
    content: string,
  ): Promise<void> {
    const contentWithoutMentions = content.replace(
      /<span[^>]*class="[^"]*chat-input-mention[^"]*"[^>]*>@[^<]+<\/span>/g,
      ''
    );

    // 1) Try internal app link first (DB lookup, no HTTP fetch)
    const resolvedInternal = await this.resolveInternalLinkPreview(
      messageId,
      conversationId,
      contentWithoutMentions,
    );
    if (resolvedInternal) return;

    // 2) Try Bitbucket PR link preview (API-first with URL-derived fallback)
    const url = extractFirstUrl(contentWithoutMentions);
    if (url) {
      const resolvedBitbucket = await this.resolveBitbucketLinkPreview(
        messageId,
        conversationId,
        url,
      );
      if (resolvedBitbucket) return;
    }

    // 3) Fall through to external OG-based preview
    await this.resolveExternalLinkPreview(messageId, conversationId, contentWithoutMentions);
  }

  /**
   * Fetch external OG metadata for the first URL in the content,
   * then write the result to message.link_preview_md.
   */
  private async resolveExternalLinkPreview(
    messageId: string,
    conversationId: string,
    content: string,
  ): Promise<void> {
    const url = extractFirstUrl(content);
    if (!url) return;

    logger.info('[MessagesSideEffect] Detected external URL:', url);

    const metadata = await linkPreviewService.fetchMetadata(url) as ExternalLinkMetadata;

    const md = serializeLinkPreviewMd({
      url: metadata.url,
      title: metadata.title,
      description: metadata.description,
      siteName: metadata.siteName,
      image: metadata.image,
      favicon: metadata.favicon,
    });
    if (!md) return;

    await db.message.update({
      where: { messageId },
      data: { link_preview_md: md },
    });

    await this.syncConversationMessageMetadata(conversationId);

    logger.info(`[MessagesSideEffect] Updated message ${messageId} with external link preview`);
  }

  /**
   * Detect an internal app URL in content and resolve it via DB lookups.
   * Returns true if an internal preview was written, false otherwise.
   */
  private async resolveInternalLinkPreview(
    messageId: string,
    sourceConversationId: string,
    content: string,
  ): Promise<boolean> {
    const rawUrl = extractInternalUrl(content);
    if (!rawUrl) return false;

    const info = parseInternalUrl(rawUrl);
    if (!info) return false;

    logger.info('[MessagesSideEffect] Detected internal URL:', rawUrl);

    let targetMessageId: string | undefined = info.messageId;
    let targetConversationId = info.conversationId;

    if (!targetConversationId && info.ticketId) {
      const ticket = await db.ticket.findUnique({
        where: { id: info.ticketId },
        select: { conversationId: true },
      });
      targetConversationId = ticket?.conversationId ?? undefined;
    }

    if (!targetMessageId && targetConversationId) {
      const conv = await db.conversation.findUnique({
        where: { conversationId: targetConversationId },
        select: { initialMessageId: true },
      });
      targetMessageId = conv?.initialMessageId ?? undefined;
    }

    if (!targetMessageId) return false;

    const targetMessage = await db.message.findUnique({
      where: { messageId: targetMessageId },
    });
    if (!targetMessage) return false;

    const [senderUser, conv, messageAttachments] = await Promise.all([
      db.user.findUnique({
        where: { id: targetMessage.senderId },
        select: { id: true, name: true, picture: true },
      }),
      db.conversation.findUnique({
        where: { conversationId: targetMessage.conversationId },
        select: { conversationId: true, replyCount: true, channelId: true },
      }),
      db.messageAttachment.findMany({
        where: {
          entityId: targetMessageId,
          entityType: AttachmentEntityType.CHAT,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!senderUser || !conv) return false;

    const channel = await db.channel.findUnique({
      where: { id: conv.channelId },
      select: { id: true, name: true, scopeType: true },
    });
    if (!channel) return false;

    const rawContent = targetMessage.content;
    const plainForLength = rawContent
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Read nested link preview from link_preview_md (new) or fall back to metadata.linkPreview (legacy)
    let nestedLinkPreview: Record<string, unknown> | undefined;
    if (targetMessage.link_preview_md) {
      const parsed = parseLinkPreviewMd(targetMessage.link_preview_md);
      if (parsed) {
        nestedLinkPreview = parsed as unknown as Record<string, unknown>;
      }
    } else {
      const msgMeta = targetMessage.metadata as Record<string, unknown> | null;
      nestedLinkPreview = msgMeta?.['linkPreview'] as Record<string, unknown> | undefined;
    }

    // Skip ticket attach for message-level links so a copied reply doesn't render as the ticket card.
    const ticket = info.type === 'message'
      ? null
      : await db.ticket.findFirst({
          where: { conversationId: targetMessage.conversationId },
        });

    const attachments = messageAttachments.map((att) => ({
      id: att.id,
      entityType: att.entityType,
      entityId: att.entityId,
      storageProvider: att.storageProvider,
      originalFilename: att.originalFilename,
      mimetype: att.mimetype,
      size: att.size,
      width: att.width ?? null,
      height: att.height ?? null,
      uploadedByUserId: att.uploadedByUserId,
      createdAt: att.createdAt.getTime(),
      url: att.url,
      createdBy: att.createdBy,
      metadata: (att.metadata as Record<string, unknown>) ?? null,
      conversationId: att.conversationId ?? null,
      thumbnailUrl: att.thumbnailUrl ?? null,
    }));

    const previewData: MessagePreviewData = {
      url: rawUrl,
      messageId: targetMessage.messageId,
      channelId: channel.id,
      channelName: channel.name,
      channelScopeType: channel.scopeType,
      senderId: senderUser.id,
      senderName: senderUser.name,
      senderAvatar: senderUser.picture ?? undefined,
      content: plainForLength.length > 300 ? rawContent.slice(0, 600) : rawContent,
      timestamp: targetMessage.createdAt.toISOString(),
      replyCount: conv.replyCount,
      isDeleted: targetMessage.isDeleted,
      hasAttachment: attachments.length > 0,
      attachments: attachments.length > 0 ? attachments : undefined,
      nestedLinkPreview: nestedLinkPreview ?? undefined,
      ticket: ticket ? {
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        statusV2: ticket.statusV2,
        priority: ticket.priority,
        xyneId: ticket.xyneId,
        createdBy: ticket.createdBy,
        assignedTo: ticket.assignedTo,
        eta: ticket.eta?.toISOString() ?? null,
        conversationId: ticket.conversationId,
        channelId: ticket.channelId,
        stageName: ticket.stageName,
        projectId: ticket.projectId,
        boardId: ticket.boardId,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
      } satisfies TicketPreviewSnapshot : undefined,
    };

    const md = serializeMessagePreviewMd(previewData);
    if (!md) return false;

    await db.message.update({
      where: { messageId },
      data: { link_preview_md: md },
    });

    await this.syncConversationMessageMetadata(sourceConversationId);

    logger.info(`[MessagesSideEffect] Updated message ${messageId} with internal link preview`);
    return true;
  }

  /**
   * Keep denormalized conversation message metadata in sync after direct Prisma updates
   * to a message row, such as link_preview_md side-effect writes.
   */
  private async syncConversationMessageMetadata(conversationId?: string): Promise<void> {
    if (!conversationId) {
      return;
    }

    await messageMetadataService.syncInitialMessageMd(conversationId);
  }

  private async createReplyActivity(
    conversationId: string,
    replyMessageId: string,
    mentionedUserIds: string[],
    senderUserId: string,
    channelId: string,
    channelName: string,
    senderName: string,
    cleanContent: string,
    channelParticipants: Array<{ userId: string; user: { email: string; name: string } }>,
    senderPicture: string = '',
    isDMChannel: boolean = false,
    prefetchedData?: PrefetchedFilterData,
    isGroupDM: boolean = false,
    excludedUserIds: string[] = [],
  ): Promise<void> {
    const channelParticipantIds = new Set(channelParticipants.map(p => p.userId));
    const participants = await db.conversationParticipant.findMany({
      where: {
        conversationId,
        isSubscribed: true,
      },
      select: { userId: true }
    });

    const participantIds = participants
      .map(p => p.userId)
      .filter(userId => userId !== senderUserId)
      .filter(userId => !mentionedUserIds.includes(userId))
      .filter(userId => !excludedUserIds.includes(userId));

    const validParticipantIds = participantIds.filter(userId =>
      channelParticipantIds.has(userId)
    );

    if (validParticipantIds.length === 0) return;

    await Promise.all(
      validParticipantIds.map(userId =>
        activityService.upsertReplyActivityV2({
          conversationId,
          parentMessageId: conversationId,
          channelId,
          actorId: senderUserId,
          recipientUserId: userId,
          latestReplyMessageId: replyMessageId,
        })
      )
    );

    const userEmailMap = new Map(
      channelParticipants
        .filter(p => validParticipantIds.includes(p.userId) && p.user?.email)
        .map(p => [p.userId, p.user.email])
    );
    const replyEmails = Array.from(userEmailMap.values());

    let slackRecipientEmails = replyEmails;
    try {
      const { deliveredUserIds } = await notificationService.createThreadReplyNotifications(
        validParticipantIds,
        replyMessageId,
        conversationId,
        channelId,
        channelName,
        senderUserId,
        senderName,
        cleanContent,
        this.ctx.workspaceId,
        isDMChannel,
        senderPicture,
        prefetchedData,
        isGroupDM,
      );

      slackRecipientEmails = getSlackRecipientEmails(replyEmails, deliveredUserIds, userEmailMap);
    } catch (error) {
      logger.error('[SIDE-EFFECT] Spaces thread reply notifications failed — sending Slack to all recipients', { error });
    }

    await slackService.sendThreadReplyNotifications(
      slackRecipientEmails,
      senderName,
      channelName,
      channelId,
      conversationId,
      replyMessageId
    );
  }

  private async handleDMChannelMessage(
    messageId: string,
    conversationId: string,
    channelId: string,
    senderId: string,
    appUserIds: string[],
    channelName: string,
    senderName: string,
    senderPicture: string,
    cleanContent: string,
    htmlContent: string,
    initialMessageId: string | null,
    channelParticipants: Array<{ userId: string; user: { email: string; name: string } }>,
    mentionType: '@channel' | '@here' | undefined,
    createdAt: Date,
    scopeType: ChannelScopeType,
    hasAttachment: boolean,
    prefetchedData?: PrefetchedFilterData,
  ): Promise<void> {
    const isLargeGroupDm = channelParticipants.length > LARGE_GROUP_DM_THRESHOLD;
    const isReply = !!(initialMessageId && initialMessageId !== messageId);
    if (mentionType) {
      await this.handleSpecialMentionActivities(channelId, messageId, senderId, mentionType, [], initialMessageId !== messageId);
    }

    if (scopeType === 'DM' && !appUserIds.includes(senderId)) {
      const attachments = hasAttachment
        ? await messageAttachmentRepository.findByMessageId(messageId)
        : [];

      void this.handlleMessageAppEvents(AppEventType.DM, {
        conversationId,
        messageId,
        content: htmlContent,
        cleanContent: cleanContent,
        createdAt,
        userId: senderId,
        channelId,
        ...(attachments.length > 0 && {
          attachments: attachments.map(att => ({
            attachmentId: att.id,
            fileName: att.originalFilename,
            fileSize: att.size,
            mimeType: att.mimetype,
            fileUrl: att.url,
          })),
        }),
      }, appUserIds);

    }

    if (isReply && conversationId) {
      let groupDMThreadMentionedUserIds: string[] = [];
      if (scopeType === ChannelScopeType.GROUP_DM) {
        const recipientIds = channelParticipants
          .map(p => p.userId)
          .filter(id => id !== senderId);

        if (mentionType) {
          // @channel/@here in GROUP_DM thread: use 'thread_mention' context.
          try {
            const { deliveredUserIds } = await notificationService.createMentionNotifications(
              recipientIds,
              messageId,
              conversationId,
              channelId,
              channelName,
              senderId,
              senderName,
              cleanContent,
              this.ctx.workspaceId,
              mentionType,
              false,
              true,
              senderPicture,
              prefetchedData,
              true, // isGroupDM
            );
            groupDMThreadMentionedUserIds = deliveredUserIds;
          } catch (error) {
            logger.error('[SIDE-EFFECT] GROUP_DM thread @channel/@here notifications failed', { error });
          }
        } else {
          // @username mentions in GROUP_DM thread.
          const flowRawText = getFlowJsonRawTextForMentions(htmlContent);
          const contentForMentions = flowRawText ?? htmlContent;
          const participantSet = new Set(channelParticipants.map(p => p.userId));
          const mentioned = await extractAllUsersForNotification(
            contentForMentions,
            this.ctx.workspaceId,
            channelId,
          );
          const groupDMThreadMentionedUsers = mentioned
            .filter(u => (u.mentionSource === 'direct' || u.mentionSource === 'group')
              && participantSet.has(u.userId) && u.userId !== senderId)
            .map(u => ({ userId: u.userId, mentionSource: u.mentionSource as 'direct' | 'group' }));
          groupDMThreadMentionedUserIds = groupDMThreadMentionedUsers.map(u => u.userId);

          if (groupDMThreadMentionedUserIds.length > 0) {
            try {
              await notificationService.createMentionNotifications(
                groupDMThreadMentionedUserIds,
                messageId,
                conversationId,
                channelId,
                channelName,
                senderId,
                senderName,
                cleanContent,
                this.ctx.workspaceId,
                undefined,
                false,
                true,
                senderPicture,
                prefetchedData,
                true, // isGroupDM
              );
            } catch (error) {
              logger.error('[SIDE-EFFECT] GROUP_DM thread mention notifications failed', { error });
            }

            // Activity records for @mentioned users in GROUP_DM thread replies.
            const mentionActivities = groupDMThreadMentionedUsers.map(u => ({
              id: uuidv4(),
              userId: u.userId,
              actorId: senderId,
              actorAction: u.mentionSource === 'direct' ? 'mentioned_user' : 'group_mention',
              actionSource: 'message' as const,
              actionSourceId: messageId,
              messageId,
              channelId,
              isThreadActivity: true,
              classification: ActivityClassification.PENDING,
            }));
            await activityService.createActivities(mentionActivities);
          }
        }
      }

      await this.createReplyActivity(
        conversationId,
        messageId,
        groupDMThreadMentionedUserIds,
        senderId,
        channelId,
        channelName,
        senderName,
        cleanContent,
        channelParticipants,
        senderPicture,
        scopeType === ChannelScopeType.DM,
        prefetchedData,
        scopeType === ChannelScopeType.GROUP_DM,
      );
    } else {
      if (!mentionType && !isLargeGroupDm) {
        await createDirectMessageActivities(messageId, senderId, channelId, initialMessageId !== messageId);
      }

      const recipientIds = channelParticipants
        .map(p => p.userId)
        .filter(userId => userId !== senderId);

      const userEmailMap = new Map(
        channelParticipants
          .filter(p => p.user?.email)
          .map(p => [p.userId, p.user.email])
      );
      const recipientEmails = channelParticipants
        .filter(p => p.userId !== senderId && p.user?.email)
        .map(p => p.user.email);

      let allDeliveredUserIds: string[] = [];
      let slackRecipientEmails = recipientEmails;

      if (scopeType === ChannelScopeType.GROUP_DM && mentionType) {
        // Case 1: GROUP_DM @channel/@here — route through createMentionNotifications.
        try {
          const { deliveredUserIds } = await notificationService.createMentionNotifications(
            recipientIds,
            messageId,
            conversationId,
            channelId,
            channelName,
            senderId,
            senderName,
            cleanContent,
            this.ctx.workspaceId,
            mentionType,
            false,
            false,
            senderPicture,
            prefetchedData,
            true, // isGroupDM
          );
          allDeliveredUserIds = deliveredUserIds;
        } catch (error) {
          logger.error('[SIDE-EFFECT] GROUP_DM @channel/@here mention notifications failed', { error });
        }
        } else {
        // Case 2: GROUP_DM @username mentions + regular DM notifications.
        let groupDMMentionedUserIds: string[] = [];
        let groupDMMentionedUsers: Array<{ userId: string; mentionSource: 'direct' | 'group' }> = [];
        if (scopeType === ChannelScopeType.GROUP_DM) {
          const flowRawText = getFlowJsonRawTextForMentions(htmlContent);
          const contentForMentions = flowRawText ?? htmlContent;
          const participantSet = new Set(channelParticipants.map(p => p.userId));
          const mentioned = await extractAllUsersForNotification(
            contentForMentions,
            this.ctx.workspaceId,
            channelId,
          );
          groupDMMentionedUsers = mentioned
            .filter(u => (u.mentionSource === 'direct' || u.mentionSource === 'group')
              && participantSet.has(u.userId) && u.userId !== senderId)
            .map(u => ({ userId: u.userId, mentionSource: u.mentionSource as 'direct' | 'group' }));
          groupDMMentionedUserIds = groupDMMentionedUsers.map(u => u.userId);
        }

        // Mention notifications for explicitly @mentioned users.
        if (groupDMMentionedUserIds.length > 0) {
          try {
            const { deliveredUserIds } = await notificationService.createMentionNotifications(
              groupDMMentionedUserIds,
              messageId,
              conversationId,
              channelId,
              channelName,
              senderId,
              senderName,
              cleanContent,
              this.ctx.workspaceId,
              undefined,
              false,
              false,
              senderPicture,
              prefetchedData,
              true, // isGroupDM
            );
            allDeliveredUserIds = deliveredUserIds;
          } catch (error) {
            logger.error('[SIDE-EFFECT] GROUP_DM mention notifications failed', { error });
          }

          // Activity records for @mentioned users in GROUP_DM parent messages.
          const mentionActivities = groupDMMentionedUsers.map(u => ({
            id: uuidv4(),
            userId: u.userId,
            actorId: senderId,
            actorAction: u.mentionSource === 'direct' ? 'mentioned_user' : 'group_mention',
            actionSource: 'message' as const,
            actionSourceId: messageId,
            messageId,
            channelId,
            isThreadActivity: false,
            classification: ActivityClassification.PENDING,
          }));
          await activityService.createActivities(mentionActivities);
        }

        // DM notifications for non-mentioned recipients only.
        const mentionedSet = new Set(groupDMMentionedUserIds);
        const dmRecipientIds = groupDMMentionedUserIds.length > 0
          ? recipientIds.filter(id => !mentionedSet.has(id))
          : recipientIds;

        try {
          const { deliveredUserIds } = await notificationService.createDirectMessageNotifications(
            dmRecipientIds,
            messageId,
            conversationId,
            channelId,
            senderId,
            senderName,
            cleanContent,
            this.ctx.workspaceId,
            scopeType,
            senderPicture,
            channelName,
            prefetchedData,
          );
          allDeliveredUserIds = [...allDeliveredUserIds, ...deliveredUserIds];
        } catch (error) {
          logger.error('[SIDE-EFFECT] Spaces DM notifications failed — sending Slack to all recipients', { error });
        }
      }

      slackRecipientEmails = getSlackRecipientEmails(recipientEmails, allDeliveredUserIds, userEmailMap);
      await slackService.sendDirectMessageNotifications(
        slackRecipientEmails,
        senderName,
        cleanContent,
        channelId
      );
    }

    // Queue Vespa indexing for message attachments in DM channels
    await this.queueVespaIndexingForAttachments(messageId);
  }

  /**
   * Queue Vespa indexing for message attachments
   * Fetches attachments by entityId (messageId) and queues them for indexing
   */
  private async queueVespaIndexingForAttachments(messageId: string): Promise<void> {
    const attachments = await db.messageAttachment.findMany({
      where: {
        entityId: messageId,
        entityType: AttachmentEntityType.CHAT
      },
      select: { id: true, createdBy: true, mimetype: true }
    });

    // Filter only supported MIME types (PDF, DOCX, TXT, MD, etc.)
    const supportedAttachments = attachments.filter(att => isSupportedMimeType(att.mimetype));

    for (const attachment of supportedAttachments) {
      try {
        await vespaQueue.addJob({
          schema: fileSchema,
          docId: attachment.id,
          jobType: 'feed',
          userId: attachment.createdBy,
          workspaceId: this.ctx.workspaceId,
          app: SubApp.CHAT_ATTACHMENT,
        });
        logger.info(`[MessagesSideEffectHandler] Queued Vespa indexing for attachment ${attachment.id} in message ${messageId}`);
      } catch (error) {
        logger.error(`[MessagesSideEffectHandler] Failed to queue Vespa job for attachment ${attachment.id}:`, error);
      }
    }
  }

  private async handleSpecialMentionActivities(
    channelId: string,
    messageId: string,
    senderId: string,
    mentionType: '@channel' | '@here' | undefined,
    mentionedUserIds: string[] = [],
    isThreadActivity: boolean = false,
  ): Promise<void> {
    if (!mentionType) {
      return;
    }

    const processSpecialMentionUsers = async (recipientIds: string[]): Promise<void> => {
      const excludedUserSet = new Set(mentionedUserIds);
      let uniqueRecipientIds = [
        ...new Set(
          recipientIds.filter(id => id && id !== senderId && !excludedUserSet.has(id))
        ),
      ];
      if (uniqueRecipientIds.length === 0) return;

      const activities = uniqueRecipientIds.map(userId => ({
        id: uuidv4(),
        userId,
        actorId: senderId,
        actorAction: 'group_mention' as const,
        // Dual-write: populate both old and new columns
        actionSource: 'message' as const,
        actionSourceId: messageId,
        messageId: messageId,
        channelId,
        isThreadActivity,
        classification: ActivityClassification.PENDING,
        classificationJobType: ActivityClassificationJobType.SPECIAL_MENTION_AUDIENCE,
      }));
      await activityService.createActivities(activities);
    };

    if (mentionType === '@channel') {
      const channelUsers = await getChannelParticipantsForMention(channelId);
      const channelUserIds = channelUsers.map(u => u.userId);
      await processSpecialMentionUsers(channelUserIds);
      return;
    }

    if (mentionType === '@here') {
      const onlineUsers = await getOnlineChannelParticipants(channelId);
      const onlineUserIds = onlineUsers.map(u => u.userId);
      await processSpecialMentionUsers(onlineUserIds);
    }
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const { entityId: messageId } = job;
    const previousValue = job.previousValue as MessagePreviousValue | undefined;
    // Emit MESSAGE.DELETED to trigger cleanup of surface links and nudges.
    // We need conversation/channel/project context; fetch what's still available.
    try {
      const conversation = await db.conversation.findFirst({
        where: {
          OR: [{ initialMessageId: messageId }],
        },
        select: { conversationId: true, channelId: true },
      });

      const channelId = conversation?.channelId;
      const channel = channelId
        ? await db.channel.findUnique({
            where: { id: channelId },
            select: { projectId: true },
          })
        : null;

      void activityTrackingService.saveActivityEvent({
        user_id: this.ctx.userID,
        session_id: `side-effect-delete-${messageId}`,
        event_category: 'MESSAGE',
        event_name: 'DELETED',
        url: '',
        trigger_type: 'SYSTEM',
        platform: Platform.WEB,
        timestamp: Date.now(),
        context_metadata: {
          messageId,
          conversationId: conversation?.conversationId,
          channelId,
          projectId: channel?.projectId,
        },
      });
    } catch (error) {
      logger.warn('[MessagesSideEffectHandler] Failed to emit MESSAGE.DELETED event', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (previousValue?.channelId && previousValue.conversationId && previousValue.msgType !== 'SYSTEM') {
      await this.sendMessageChangeNotifications(
        NotificationType.MESSAGE_DELETED,
        messageId,
        previousValue.channelId,
        previousValue.conversationId,
        previousValue.isThreadReply,
      );
    }

    const reactions = await db.reaction.findMany({
      where: { messageId },
      select: { reactionId: true },
    });

    const reactionIds = reactions.map(r => r.reactionId);

    await Promise.allSettled([
      activityService.deleteActivitiesBySourceIds('reaction', reactionIds),
      activityService.deleteActivitiesBySource('message', messageId),
    ]);

    if (!previousValue?.conversationId || previousValue.msgType === 'SYSTEM') {
      return;
    }

    const conversation = await db.conversation.findUnique({
      where: { conversationId: previousValue.conversationId },
      select: { initialMessageId: true, channelId: true },
    });

    if (!conversation?.initialMessageId || !conversation.channelId) {
      return;
    }

    if (conversation.initialMessageId === previousValue.messageId) {
      return;
    }

    const replies = await db.message.findMany({
      where: {
        conversationId: previousValue.conversationId,
        isDeleted: false,
        messageId: { not: conversation.initialMessageId },
      },
      select: { messageId: true, senderId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    let repliers: string[] = [];
    for (const reply of replies) {
      repliers = repliers.filter(id => id !== reply.senderId);
      repliers.push(reply.senderId);
    }

    const channelParticipants = await db.channelParticipant.findMany({
      where: { channelId: conversation.channelId },
      select: { userId: true },
    });
    const channelParticipantIds = new Set(channelParticipants.map(p => p.userId));

    const participants = await db.conversationParticipant.findMany({
      where: {
        conversationId: previousValue.conversationId,
        isSubscribed: true,
      },
      select: { userId: true },
    });
    const recipientUserIds = participants
      .map(p => p.userId)
      .filter(userId => channelParticipantIds.has(userId));

    if (repliers.length === 0) {
      await activityService.deleteReplyActivitiesV2(previousValue.conversationId, recipientUserIds);
      return;
    }

    const latestReply = replies[replies.length - 1];
    if (latestReply?.messageId && latestReply?.senderId) {
      if (recipientUserIds.includes(latestReply.senderId)) {
        await activityService.deleteReplyActivitiesV2(
          previousValue.conversationId,
          [latestReply.senderId]
        );
      }

      const filteredRecipients = recipientUserIds.filter(
        userId => userId !== latestReply.senderId
      );

      if (filteredRecipients.length === 0) {
        return;
      }

      await activityService.updateReplyActivitiesMetadataV2({
        conversationId: previousValue.conversationId,
        recipientUserIds: filteredRecipients,
        actorId: latestReply.senderId,
        latestReplyMessageId: latestReply.messageId,
      });
    }
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const previousValue = job.previousValue as MessagePreviousValue | undefined;
    if (!previousValue || previousValue.msgType === 'SYSTEM' || !previousValue.channelId) {
      return;
    }
    const currentMessage = await db.message.findUnique({
      where: { messageId: previousValue.messageId },
      select: { isDeleted: true, content: true, edited: true },
    });
    if (!currentMessage) return;

    if (!previousValue.isDeleted && currentMessage.isDeleted) {
      await this.sendMessageChangeNotifications(
        NotificationType.MESSAGE_DELETED,
        previousValue.messageId,
        previousValue.channelId,
        previousValue.conversationId,
        previousValue.isThreadReply,
      );
    } else if (currentMessage.edited && currentMessage.content !== previousValue.content && !currentMessage.isDeleted) {
      await this.sendMessageChangeNotifications(
        NotificationType.MESSAGE_EDITED,
        previousValue.messageId,
        previousValue.channelId,
        previousValue.conversationId,
        previousValue.isThreadReply,
        currentMessage.content,
      );
    }
  }

  private async sendMessageChangeNotifications(
    type: NotificationType,
    messageId: string,
    channelId: string,
    conversationId: string,
    isThreadReply: boolean,
    content?: string,
  ): Promise<void> {
    try {
      const recipients = await db.notification.findMany({
        where: {
          relatedEntityType: 'message',
          relatedEntityId: messageId,
          deliveryMethods: {
            hasSome: [NotificationDeliveryMethod.IOS, NotificationDeliveryMethod.ANDROID],
          },
        },
        select: { userId: true },
        distinct: ['userId'],
      });

      await Promise.allSettled(
        recipients.map(({ userId }) =>
          notificationService.createNotification(
            userId,
            {
              title: '',
              message: '',
              type,
              relatedEntityId: messageId,
              metadata: {
                channelId,
                conversationId,
                messageId,
                isThreadReply,
                ...(content !== undefined ? { content: extractPlainTextFromHtml(content) } : {}),
              },
            },
            { sendDesktop: false, sendMobile: true, isSilent: true }
          )
        )
      );
    } catch (err) {
      logger.warn(`[MessagesSideEffectHandler] Failed to send ${type} notifications`, {
        messageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handlleMessageAppEvents(
    eventType: AppEventType,
    payload: AppMentionEventPayload | DMEventPayload | UserMentionedEventPayload,
    userIds: string[],
  ): Promise<void> {
    const event: BaseAppEvent = {
      eventType,
      payload,
      timestamp: new Date().toISOString(),
    };

    try {
      await handleEventSubscriptionsForUsers(event, userIds);
    } catch (error) {
      logger.error(`Failed to handle message app events`, {
        eventType,
        payload,
        userIds,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle bot mentions - trigger bot execution when @mentioned in channels/threads
   */
  private async handleBotMentions(
    message: { messageId: string; senderId: string; content: string; conversationId: string },
    conversation: { channelId: string; initialMessageId: string | null },
    channel: { id?: string; name: string | null; scopeType: string | null } | null,
    sender: { name: string; userType?: string } | null,
    channelParticipants: Array<{ userId: string; user: { email: string; name: string } }>
  ): Promise<void> {
    try {
      // ACL CHECK: Verify sender is a channel participant before proceeding
      const isSenderParticipant = channelParticipants.some(p => p.userId === message.senderId);
      if (!isSenderParticipant) {
        logger.warn('[BOT-MENTION] Sender is not a channel participant, skipping bot mention handling', {
          messageId: message.messageId,
          senderId: message.senderId,
          channelId: channel?.id || conversation.channelId,
        });
        return;
      }

      // Skip if DM channel (already handled by mutator auto-response)
      if (channel?.scopeType === 'DM' || channel?.scopeType === 'GROUP_DM') {
        return;
      }

      // CRITICAL FIX: Skip bot messages to prevent infinite loops
      // When a bot responds, its response message would trigger this again
      if (sender?.userType === 'BOT') {
        logger.debug('[BOT-MENTION] Skipping bot message to prevent infinite loop', {
          messageId: message.messageId,
          senderId: message.senderId,
        });
        return;
      }

      // Check if this is a thread reply
      const isThreadReply = conversation.initialMessageId && conversation.initialMessageId !== message.messageId;

      // Extract bot user IDs from explicit @mentions in content
      const botMentions = await extractBotMentions(message.content);

      // Thread continuation: if the user replies in a thread that was started by a bot
      // (with no explicit @mention), auto-route to that same bot. This allows natural
      // back-and-forth conversation without requiring explicit @mentions on every reply.
      let threadBotInfo: { botUserId: string; botId: string; botDefinition: BotDefinition } | null = null;
      if (isThreadReply && botMentions.length === 0 && conversation.initialMessageId) {
        // Get initial message with sender details
        const initialMessage = await db.message.findUnique({
          where: { messageId: conversation.initialMessageId },
          select: {
            senderId: true,
            sender: {
              select: {
                id: true,
                userType: true,
              }
            }
          },
        });

        if (initialMessage?.sender && initialMessage.sender.userType === 'BOT') {
          // Look up the bot catalog entry by DB user id instead of parsing the email
          const dbUserId = initialMessage.sender.id;
          const botEntry = botCatalog.getAll().find(
            e => botCatalog.getDbUserId(e.definition.id) === dbUserId
          );
          const botDefinition = botEntry?.definition;

          if (botEntry && botDefinition) {
            threadBotInfo = {
              botUserId: dbUserId,
              botId: botDefinition.id,
              botDefinition,
            };
          }
        }
      }

      // If no explicit mentions and not a bot thread, skip
      if (botMentions.length === 0 && !threadBotInfo) {
        return;
      }

      // Process explicit mentions or thread bot
      const botsToProcess = botMentions.length > 0
        ? botMentions
        : (threadBotInfo ? [threadBotInfo] : []);

      // Process each bot (explicit mentions or thread bot)
      for (const { botUserId, botId, botDefinition } of botsToProcess) {
        try {
          // SAFETY FIX: Check if botDefinition exists before accessing properties
          if (!botDefinition) {
            logger.warn('[BOT-MENTION] Bot definition not found, skipping', { botId });
            continue;
          }

          // Only explicitly chat-enabled bots respond to channel/thread @mentions
          if (!CHAT_ENABLED_BOT_IDS.has(botId)) {
            continue;
          }

          // Extract plain-text question. Both paths must strip HTML since message
          // content is stored as TipTap HTML, not plain text.
          let question = threadBotInfo
            ? extractPlainTextFromHtml(message.content)
            : this.extractQuestionFromMention(message.content, botUserId);

          if (!question.trim()) {
            const isFirstMessageInThread = conversation.initialMessageId === message.messageId;
            question = (isFirstMessageInThread || !conversation.initialMessageId)
              ? 'What all can you do and how can you help me?'
              : 'What happened in this thread until now?';
          }

          await executeBotForMention({
            bot: { botUserId, botId, botDefinition },
            message,
            conversation,
            question,
            sender,
            channelParticipants,
          });
        } catch (botError) {
          logger.error('[BOT-MENTION] Failed to execute bot', {
            botId,
            messageId: message.messageId,
            error: botError instanceof Error ? botError.message : String(botError),
          });
        }
      }
    } catch (error) {
      logger.error('[BOT-MENTION] Error handling bot mentions', {
        messageId: message.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Extract the question from an explicit @mention message: removes the bot's
   * mention span then strips remaining HTML tags to return plain text.
   */
  private extractQuestionFromMention(content: string, botUserId: string): string {
    return extractPlainTextFromHtml(
      content.replace(
        new RegExp(`<span[^>]*data-user-id="${botUserId}"[^>]*>@[^<]*</span>`, 'g'),
        '',
      ),
    );
  }
}
