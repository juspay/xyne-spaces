import { DatabaseClient } from '@/database/client';
import {logger} from '@/utils/logger';

const prisma = DatabaseClient.getInstance();

export class UnreadService {
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
    conversationId?: string // ✅ Now optional
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
      const conversationSeenCutoffAt =
        seenConversations[seenConversations.length - 1]?.createdAt ?? viewedAt;

      const updateData: {
        lastViewedAt: Date;
        conversationSeenCutoffAt: Date;
        lastViewedConversationId?: string;
        updatedAt: Date;
      } = {
        lastViewedAt: viewedAt,
        conversationSeenCutoffAt,
        updatedAt: viewedAt,
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
    } catch (error) {
      logger.error('Error marking channel as viewed:', error);
      throw error;
    }
  }
}

export const unreadService = new UnreadService();