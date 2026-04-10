import { v4 as uuidv4 } from 'uuid';
import { ActivityClassification, ActivityClassificationJobType, AttachmentEntityType, UserType } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
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
import { activityTrackingService } from '@/services/activityTrackingService';
import { Platform, serializeMessagePreviewMd, serializeLinkPreviewMd, parseLinkPreviewMd, type MessagePreviewData, type TicketPreviewSnapshot } from '@xyne/shared';
import { handleEventSubscriptionsForUsers } from '@/apps/core/eventSubscriptionUtils';
import { BaseAppEvent, AppEventType, AppMentionEventPayload, DMEventPayload, UserMentionedEventPayload } from '@/apps/types';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import { extractInternalUrl, parseInternalUrl, extractFirstUrl } from '@/utils/urlUtils';
import { linkPreviewService, type ExternalLinkMetadata } from '@/services/linkPreviewService';
import { botCatalog } from '@/bots/unified/catalog/bot-catalog';
import { extractBotMentions, executeBotForMention, CHAT_ENABLED_BOT_IDS } from '@/services/bots';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import type { BotDefinition } from '@/bots/unified/types/unified-bot';
import { messageMetadataService } from '@/services/messageMetadataService';

const LARGE_GROUP_DM_THRESHOLD = 8;
const messageAttachmentRepository = new MessageAttachmentRepository();

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

    const [channel, sender, channelParticipantsRaw] = await Promise.all([
      db.channel.findUnique({
        where: { id: channelId },
        select: { name: true, scopeType: true, projectId: true }
      }),
      db.user.findUnique({
        where: { id: senderId },
        select: { name: true, userType: true }
      }),
      db.channelParticipant.findMany({
        where: { channelId },
        select: { userId: true }
      })
    ]);

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
    let cleanContent = content.replace(/<[^>]*>/g, '');
    if (!cleanContent.trim() && message.hasAttachment) {
      cleanContent = 'Sent an attachment';
    }
    const isDMChannel = channel?.scopeType === 'DM' || channel?.scopeType === 'GROUP_DM';
    const specialMentions = extractSpecialMentions(content);
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

    if (isDMChannel) {
      const dmChannelName = channelParticipants
        .filter(p => channel?.scopeType === 'DM' ? p.userId !== senderId : true)
        .map(p => p.user.name || 'Unknown')
        .join(', ');

      await this.handleDMChannelMessage(
        messageId,
        conversationId,
        channelId,
        senderId,
        appUserIds,
        dmChannelName || 'Direct Message',
        senderName,
        cleanContent,
        content,
        conversation.initialMessageId,
        channelParticipants,
        mentionType,
        message.createdAt,
        channel?.scopeType,
        message.hasAttachment
      );
      return;
    }

    const mentionedUsers = await extractAllUsersForNotification(content, channelId);
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
        mentionedUserIds: nonAppMentionedUserIds,
      }, observerAppUserIds);
    }
    
    const finalMentionedUserIds = validMentionedUsers
      .map(user => user.userId);

    const notificationUserIds = [
      ...new Set(
        mentionedUsers
          .map(u => u.userId)
          .filter(userId => channelParticipantIds.has(userId) && userId !== senderId)
      ),
    ];

    if (validMentionedUsers.length > 0) {
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
        classification: ActivityClassification.PENDING,
      }));

      await activityService.createActivities(activities);
    }

    // Determine whether this message is a thread reply before sending notifications,
    // so mentions inside a thread can use the 'thread_mention' context which passes
    // for THREADS_ONLY users (in addition to ALL and MENTIONS_ONLY).
    const isReply = conversation.initialMessageId && conversation.initialMessageId !== messageId;

    if (notificationUserIds.length > 0) {
      await handleUnreadCount(
        channelId,
        isDMChannel,
        channelParticipants,
        senderId
      );
      const mentionedUsers = await Promise.all(
        notificationUserIds.map(userId => db.user.findUnique({
          where: { id: userId },
          select: { email: true }
        }))
      );
      const mentionedEmails = mentionedUsers.filter(u => u?.email).map(u => u!.email);

      await Promise.all([
        notificationService.createMentionNotifications(
          notificationUserIds,
          messageId,
          conversationId,
          channelId,
          channelName,
          senderId,
          senderName,
          cleanContent,
          mentionType,
          isDMChannel,
          !!isReply  // isThreadMessage: true when this mention is inside a thread reply
        ),
        slackService.sendMentionNotifications(
          mentionedEmails,
          senderName,
          channelName,
          channelId,
          conversationId,
          messageId,
          mentionType
        )
      ]);
    }

    await this.handleSpecialMentionActivities(
      channelId,
      messageId,
      senderId,
      mentionType,
      finalMentionedUserIds
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
      await this.createReplyActivity(
        conversationId,
        messageId,
        finalMentionedUserIds,
        senderId,
        channelId,
        channelName,
        senderName,
        cleanContent,
        channelParticipantIds
      );
    }

    // Queue Vespa indexing for message attachments
    await this.queueVespaIndexingForAttachments(messageId);
  }

  /**
   * Resolve link preview for a message: tries internal app link first,
   * falls back to external OG metadata.
   */
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

    // 2) Fall through to external OG-based preview
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

    const ticket = await db.ticket.findFirst({
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
    channelParticipantIds: Set<string>
  ): Promise<void> {
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
      .filter(userId => !mentionedUserIds.includes(userId));

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

    const replyUsers = await db.user.findMany({
      where: { id: { in: validParticipantIds } },
      select: { email: true }
    });
    const replyEmails = replyUsers.filter(u => u.email).map(u => u.email);

    await Promise.all([
      notificationService.createThreadReplyNotifications(
        validParticipantIds,
        replyMessageId,
        conversationId,
        channelId,
        channelName,
        senderUserId,
        senderName,
        cleanContent
      ),
      slackService.sendThreadReplyNotifications(
        replyEmails,
        senderName,
        channelName,
        channelId,
        conversationId,
        replyMessageId
      )
    ]);
  }

  private async handleDMChannelMessage(
    messageId: string,
    conversationId: string,
    channelId: string,
    senderId: string,
    appUserIds: string[],
    channelName: string,
    senderName: string,
    cleanContent: string,
    htmlContent: string,
    initialMessageId: string | null,
    channelParticipants: Array<{ userId: string; user: { email: string; name: string } }>,
    mentionType: '@channel' | '@here' | undefined,
    createdAt: Date,
    scopeType: string | undefined,
    hasAttachment: boolean
  ): Promise<void> {
    const isLargeGroupDm = channelParticipants.length > LARGE_GROUP_DM_THRESHOLD;
    if (mentionType) {
      await this.handleSpecialMentionActivities(channelId, messageId, senderId, mentionType, []);
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

    const isReply = initialMessageId && initialMessageId !== messageId;
    if (isReply && conversationId) {
      const channelParticipantIds = new Set(channelParticipants.map(p => p.userId));
      await this.createReplyActivity(
        conversationId,
        messageId,
        [],
        senderId,
        channelId,
        channelName,
        senderName,
        cleanContent,
        channelParticipantIds
      );
    } else {
      if (!mentionType && !isLargeGroupDm) {
        await createDirectMessageActivities(messageId, senderId, channelId);
      }

      const recipientIds = channelParticipants
        .map(p => p.userId)
        .filter(userId => userId !== senderId);

      const recipientEmails = channelParticipants
        .filter(p => p.userId !== senderId && p.user?.email)
        .map(p => p.user.email);

      await Promise.all([
        notificationService.createDirectMessageNotifications(
          recipientIds,
          messageId,
          conversationId,
          channelId,
          senderId,
          senderName,
          cleanContent
        ),
        slackService.sendDirectMessageNotifications(
          recipientEmails,
          senderName,
          cleanContent,
          channelId
        )
      ]);
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
    mentionedUserIds: string[] = []
  ): Promise<void> {
    if (!mentionType) {
      return;
    }

    const processSpecialMentionUsers = async (recipientIds: string[]): Promise<void> => {
      const excludedUserSet = new Set(mentionedUserIds);
      const uniqueRecipientIds = [
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
    const previousValue = job.previousValue as
      | { messageId?: string; conversationId?: string; senderId?: string; msgType?: string }
      | undefined;
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
