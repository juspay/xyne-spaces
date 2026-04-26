import { notificationService } from '@/notification-service';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { DatabaseClient } from '@/database/client';

export function getSlackRecipientEmails(
  allEmails: string[],
  deliveredUserIds: string[],
  userIdToEmailMap: Map<string, string>
): string[] {
  if (!deliveredUserIds.length) return allEmails;
  
  const deliveredEmailSet = new Set(
    deliveredUserIds.map(id => userIdToEmailMap.get(id)).filter((e): e is string => !!e)
  );
  
  return allEmails.filter(e => !deliveredEmailSet.has(e));
}

interface MessageNotificationData {
  messageId: string;
  conversationId: string;
  channelId: string;
  senderId: string;
  senderName: string;
  content: string;
  channelTitle: string;
  messageType: 'conversation_start' | 'thread_reply';
  mentionedUserIds?: string[]; // Users who were mentioned (to exclude from general notifications)
}

export class NotificationHelper {
  /**
   * Send notifications to conversation participants (not all channel participants)
   * This ensures only people involved in the thread get notified
   */
  static async handleChannelMessageNotifications(data: MessageNotificationData): Promise<void> {
    try {
      // Get subscribed conversation participants (people who should receive notifications)
      const db = DatabaseClient.getInstance();
      const conversationParticipants = await db.conversationParticipant.findMany({
        where: {
          conversationId: data.conversationId,
          isSubscribed: true, // Only notify subscribed participants
        },
        select: {
          userId: true
        }
      });

      // Remove HTML tags from message content for clean notification
      const cleanContent = data.content.replace(/<[^>]*>/g, '');

      // Build actionUrl based on message type
      let actionUrl = `/chat/${data.channelId}`;
      if (data.messageType === 'thread_reply') {
        // For thread replies, navigate directly to the thread and scroll to the specific message
        actionUrl += `/${data.conversationId}#origin=${data.conversationId}&messageId=${data.messageId}`;
      } else {
        // For conversation start, navigate to channel with origin hash
        actionUrl += `#origin=${data.conversationId}`;
      }

      // Filter out users who were newly mentioned (they get mention notifications instead)
      // Note: Sender is already excluded because they're AUTHOR type
      const mentionedUserIds = data.mentionedUserIds || [];
      const notificationPromises = conversationParticipants
        .filter((participant: { userId: string }) =>
          participant.userId !== data.senderId &&
          !mentionedUserIds.includes(participant.userId)
        )
        .map((participant: { userId: string }) => {
          const notificationType = data.messageType === 'conversation_start' ? 'new_message' : 'thread_reply';
          const title = data.messageType === 'conversation_start'
            ? `New message in ${data.channelTitle}`
            : `New reply in ${data.channelTitle}`;

          return notificationService.sendNotification(
            participant.userId,
            notificationType,
            title,
            `${data.senderName}: ${cleanContent.substring(0, 100)}${cleanContent.length > 100 ? '...' : ''}`,
            {
              channelId: data.channelId,
              conversationId: data.conversationId,
              messageId: data.messageId,
              senderId: data.senderId,
              senderName: data.senderName,
              channelTitle: data.channelTitle,
              messageType: data.messageType
            },
            actionUrl
          );
        });

      // Send all notifications concurrently
      const results = await Promise.allSettled(notificationPromises);
      const expectedCount = notificationPromises.length;

      // Log any failures
      results.forEach((result: PromiseSettledResult<string>, index: number) => {
        if (result.status === 'rejected') {
          logger.error(`Failed to send notification to conversation participant ${conversationParticipants[index]?.userId}:`, result.reason);
        }
      });

      const createdCount = results.filter(r => r.status === 'fulfilled').length;
      logger.info(`Sent ${createdCount}/${expectedCount} notifications for message ${data.messageId} in conversation ${data.conversationId}`);
    } catch (error) {
      logger.error('Failed to send channel message notifications:', error);
    }
  }

  /**
   * Send notifications for direct messages (DM and GROUP_DM channels)
   * For DMs, we notify all channel participants (since DM channels only contain relevant people)
   */
  static async handleDirectMessageNotifications(data: MessageNotificationData): Promise<void> {
    try {
      // Get all participants in the DM channel using Prisma
      const participants = await repositories.channelParticipants.findMany({
        channelId: data.channelId
      });

      // Remove HTML tags from message content for clean notification
      const cleanContent = data.content.replace(/<[^>]*>/g, '');
      const actionUrl = `/chat/${data.channelId}/${data.conversationId}#origin=${data.conversationId}&messageId=${data.messageId}`;

      // Filter out the sender and create notification promises
      const notificationPromises = participants
        .filter((participant) => participant.userId !== data.senderId)
        .map((participant) =>
          notificationService.sendNotification(
            participant.userId,
            'direct_message',
            `New message from ${data.senderName}`,
            cleanContent.substring(0, 100) + (cleanContent.length > 100 ? '...' : ''),
            {
              channelId: data.channelId,
              conversationId: data.conversationId,
              messageId: data.messageId,
              senderId: data.senderId,
              senderName: data.senderName,
              channelTitle: data.channelTitle,
              messageType: 'direct_message'
            },
            actionUrl
          )
        );

      // Send all notifications concurrently
      const results = await Promise.allSettled(notificationPromises);
      const expectedCount = notificationPromises.length;

      // Log any failures
      results.forEach((result: PromiseSettledResult<string>, index: number) => {
        if (result.status === 'rejected') {
          logger.error(`Failed to send DM notification to participant ${participants[index]?.userId}:`, result.reason);
        }
      });

      const createdCount = results.filter(r => r.status === 'fulfilled').length;
      logger.info(`Sent ${createdCount}/${expectedCount} DM notifications for message ${data.messageId}`);
    } catch (error) {
      logger.error('Failed to send direct message notifications:', error);
    }
  }

  /**
   * Send notifications for mentions in messages
   */
  static async handleMentionNotifications(
    mentionedUserIds: string[],
    data: MessageNotificationData
  ): Promise<void> {
    try {
      // Remove HTML tags from message content for clean notification
      const cleanContent = data.content.replace(/<[^>]*>/g, '');
      const actionUrl = `/chat/${data.channelId}/${data.conversationId}#origin=${data.conversationId}&messageId=${data.messageId}`;

      const notificationPromises = mentionedUserIds
        .filter(userId => userId !== data.senderId) // Don't notify sender if they mentioned themselves
        .map(userId =>
          notificationService.sendNotification(
            userId,
            'mention',
            `You were mentioned in ${data.channelTitle}`,
            `${data.senderName}: ${cleanContent.substring(0, 100)}${cleanContent.length > 100 ? '...' : ''}`,
            {
              channelId: data.channelId,
              conversationId: data.conversationId,
              messageId: data.messageId,
              senderId: data.senderId,
              senderName: data.senderName,
              channelTitle: data.channelTitle,
              messageType: 'mention'
            },
            actionUrl
          )
        );

      // Send all notifications concurrently
      const results = await Promise.allSettled(notificationPromises);
      const expectedCount = notificationPromises.length;

      // Log any failures
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.error(`Failed to send mention notification to user ${mentionedUserIds[index]}:`, result.reason);
        }
      });

      const createdCount = results.filter(r => r.status === 'fulfilled').length;
      logger.info(`Sent ${createdCount}/${expectedCount} mention notifications for message ${data.messageId}`);
    } catch (error) {
      logger.error('Failed to send mention notifications:', error);
    }
  }
}