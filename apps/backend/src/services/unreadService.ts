import { DatabaseClient } from '@/database/client';
import { NotificationType } from '@xyne/shared';
import {logger} from '@/utils/logger';
import { notificationService } from './notificationService';
import { markChannelActivitiesRead, markThreadActivitiesRead } from './activityReadStateService';

const prisma = DatabaseClient.getInstance();

export class UnreadService {
  async markThreadAsViewed(
    conversationId: string,
    userId: string
  ): Promise<void> {
    try {
      const viewedAt = new Date();

      const conversation = await prisma.conversation.findUnique({
        where: { conversationId },
        select: { channelId: true, initialMessageId: true }
      });

      if (!conversation) {
        logger.warn(`Cannot mark thread as viewed: conversation ${conversationId} not found`);
        return;
      }

      await prisma.conversationParticipant.update({
        where: {
          conversationId_userId: { conversationId, userId }
        },
        data: {
          lastReadAt: viewedAt,
        }
      });
      await markThreadActivitiesRead(prisma, userId, conversationId);

      await notificationService.createNotification(userId, {
        title: 'Silent notification',
        message: 'silent notification',
        type: NotificationType.THREAD_READ,
        metadata: { conversationId }
      }, { sendDesktop: true, sendMobile: true, isSilent: true });
    } catch (error) {
      logger.error('Error marking thread as viewed:', error);
      throw error;
    }
  }

  async getUnreadCountForChannel(channelId: string, userId: string): Promise<number> {

    try {
      const participant = await prisma.channelUserStatus.findUnique({
        where: { 
          channelId_userId: { channelId, userId } 
        },
        select: { 
          lastViewedAt: true, 
          lastViewedConversationId: true 
        }
      });

      if (!participant) {
        return 0;
      }

      const unreadCount = await prisma.conversation.count({
        where: {
          channelId: channelId,
          createdAt: { gt: participant.lastViewedAt }
        }
      });

      return unreadCount;
    } catch (error) {
      logger.error('Error calculating unread count:', error);
      return 0;
    }
  }

  async markChannelAsViewed(
    channelId: string,
    userId: string,
    conversationId?: string 
  ): Promise<void> {
    try {
      const viewedAt = new Date();
      const seenConversations = await prisma.conversation.findMany({
        where: {
          channelId,
          createdAt: { lte: viewedAt },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { createdAt: true },
      });
      await markChannelActivitiesRead(prisma, userId, channelId);
      const conversationSeenCutoffAt =
        seenConversations[seenConversations.length - 1]?.createdAt ?? viewedAt;

      const updateData: {
        lastViewedAt: Date;
        conversationSeenCutoffAt: Date;
        lastViewedConversationId?: string;
        updatedAt: Date;
        unreadCount: number;
      } = {
        lastViewedAt: viewedAt,
        conversationSeenCutoffAt,
        updatedAt: viewedAt,
        unreadCount: 0,
      };

      if (conversationId) {
        updateData.lastViewedConversationId = conversationId;
      }

      await prisma.channelUserStatus.update({
        where: {
          channelId_userId: { channelId, userId }
        },
        data: updateData
      });
      await notificationService.createNotification(userId, {
        title: 'Silent notification', 
        message: 'silent notification',
        type: NotificationType.CHANNEL_READ,
        metadata: {
          channelId: channelId,
        }
      }, { sendDesktop: true, sendMobile: true, isSilent: true });
    } catch (error) {
      logger.error('Error marking channel as viewed:', error);
      throw error;
    }
  }
}

export const unreadService = new UnreadService();