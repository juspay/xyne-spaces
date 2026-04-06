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
      const updateData: { lastViewedAt: Date; lastViewedConversationId?: string; updatedAt: Date } = {
        lastViewedAt: new Date(),
        updatedAt: new Date(),
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