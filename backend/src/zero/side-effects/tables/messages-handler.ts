import { v4 as uuidv4 } from 'uuid';
import { ActivityClassification, ActivityClassificationJobType } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { slackService } from '@/services/slackService';
import { handleUnreadCount } from '@/zero/utils/unreadCountUtlis';
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
import { Platform } from '@xyne/shared';

const LARGE_GROUP_DM_THRESHOLD = 8;

export class MessagesSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const { entityId: messageId } = job;

    const message = await db.message.findUnique({
      where: { messageId },
      select: {
        messageId: true,
        senderId: true,
        content: true,
        conversationId: true,
        msgType: true,
        hasAttachment: true
      },
    });

    if (!message || message.msgType === "SYSTEM" ) {
      return;
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
        select: { name: true }
      }),
      db.channelParticipant.findMany({
        where: { channelId },
        select: { userId: true }
      })
    ]);

    const participantUserIds = channelParticipantsRaw.map(p => p.userId);
    const users = await db.user.findMany({
      where: { id: { in: participantUserIds } },
      select: { id: true, email: true, name: true }
    });

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
        dmChannelName || 'Direct Message',
        senderName,
        cleanContent,
        conversation.initialMessageId,
        channelParticipants,
        mentionType
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
          mentionType
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

    const isReply = conversation.initialMessageId && conversation.initialMessageId !== messageId;
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
        isSubscribed: true, // Only notify subscribed participants
      },
      select: { userId: true },
    });

    const participantIds = participants
      .map(p => p.userId)
      .filter(userId => userId !== senderUserId)
      .filter(userId => !mentionedUserIds.includes(userId));

    const validParticipantIds = participantIds.filter(userId =>
      channelParticipantIds.has(userId)
    );

    if (validParticipantIds.length === 0) return;

    const activities = validParticipantIds.map(userId => ({
      id: uuidv4(),
      userId,
      actorId: senderUserId,
      actorAction: 'replied' as const,
      // Dual-write: populate both old and new columns
      actionSource: 'message' as const,
      actionSourceId: replyMessageId,
      messageId: replyMessageId,
      channelId,
      classification: ActivityClassification.PENDING,
    }));

    await activityService.createActivities(activities);

    const replyUsers = await Promise.all(
      validParticipantIds.map(userId => db.user.findUnique({
        where: { id: userId },
        select: { email: true }
      }))
    );
    const replyEmails = replyUsers.filter(u => u?.email).map(u => u!.email);

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
    channelName: string,
    senderName: string,
    cleanContent: string,
    initialMessageId: string | null,
    channelParticipants: Array<{ userId: string; user: { email: string; name: string } }>,
    mentionType: '@channel' | '@here' | undefined
  ): Promise<void> {
    const isLargeGroupDm = channelParticipants.length > LARGE_GROUP_DM_THRESHOLD;
    if (mentionType) {
      await this.handleSpecialMentionActivities(channelId, messageId, senderId, mentionType, []);
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
  }
}
