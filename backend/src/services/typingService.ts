import { redisService } from './redisService';
import {logger} from '@/utils/logger';

export interface TypingUser {
  userId: string;
  userName: string;
  userEmail?: string;
}

export class TypingService {
  private readonly TYPING_TTL = 5; // 5 seconds TTL for auto-cleanup
  private readonly TYPING_TIMEOUT = 3000; // 3 seconds of inactivity = stop typing

  /**
   * Mark user as typing in a channel
   */
  async startTypingInChannel(channelId: string, user: TypingUser): Promise<TypingUser[]> {
    const key = `typing:channel:${channelId}`;
    const field = user.userId;  // Use userId as the hash field
    const userData = JSON.stringify({
      userId: user.userId,
      userName: user.userName,
      userEmail: user.userEmail,
      timestamp: Date.now()
    });

    // Store user data with TTL using redisService
     await redisService.setHashField(key, field, userData, this.TYPING_TTL);

    return this.getTypingUsersInChannel(channelId);
  }

  /**
   * Mark user as typing in a conversation
   */
  async startTypingInConversation(conversationId: string, user: TypingUser): Promise<TypingUser[]> {
    const key = `typing:conversation:${conversationId}`;
    const userData = JSON.stringify({
      userId: user.userId,
      userName: user.userName,
      userEmail: user.userEmail,
      timestamp: Date.now()
    });

    // Store user data with TTL using redisService
    await redisService.setHashField(key, user.userId, userData, this.TYPING_TTL);

    return this.getTypingUsersInConversation(conversationId);
  }

  /**
   * Stop user typing in channel
   */
  async stopTypingInChannel(channelId: string, userId: string): Promise<TypingUser[]> {
    const key = `typing:channel:${channelId}`;
      // Delete only this user's field: HDEL key field
    await redisService.deleteHashField(key, userId);

    return this.getTypingUsersInChannel(channelId);
  }

  /**
   * Stop user typing in conversation
   */
  async stopTypingInConversation(conversationId: string, userId: string): Promise<TypingUser[]> {
    const key = `typing:conversation:${conversationId}`;
    await redisService.deleteHashField(key, userId);

    return this.getTypingUsersInConversation(conversationId);
  }

  /**
   * Get all users currently typing in a channel
   */
  async getTypingUsersInChannel(channelId: string): Promise<TypingUser[]> {
    const key = `typing:channel:${channelId}`;
    return this.getTypingUsers(key);
  }

  /**
   * Get all users currently typing in a conversation
   */
  async getTypingUsersInConversation(conversationId: string): Promise<TypingUser[]> {
    const key = `typing:conversation:${conversationId}`;
    return this.getTypingUsers(key);
  }

  /**
   * Helper method to get and filter active typing users
   */
    private async getTypingUsers(key: string): Promise<TypingUser[]> {
      // Get all users from hash: HGETALL key
      const allUserData = await redisService.getAllHashFields(key);
      
      if (!allUserData || Object.keys(allUserData).length === 0) {
        return [];
      }

      const now = Date.now();
      const activeUsers: TypingUser[] = [];
      const expiredUsers: string[] = [];

      // Iterate through all users
      for (const [userId, userData] of Object.entries(allUserData)) {
        try {
          const parsedUser = JSON.parse(userData);
          
          // Check if expired (more than 3 seconds old)
          if (now - parsedUser.timestamp > this.TYPING_TIMEOUT) {
            expiredUsers.push(userId);
          } else {
            activeUsers.push({
              userId: userId,
              userName: parsedUser.userName,
              userEmail: parsedUser.userEmail
            });
          }
        } catch (error) {
          logger.error(`Error parsing user data for ${userId}:`, error);
          expiredUsers.push(userId);
        }
      }

      // Clean up expired users
      if (expiredUsers.length > 0) {
        await redisService.deleteHashField(key, expiredUsers);
      }

      return activeUsers;
    }

  /**
   * Clean up all typing indicators for a user (useful on disconnect)
   */
  async cleanupUserTyping(userId: string): Promise<void> {
    try {
      // Since we're storing single user per key, we need to iterate through potential keys
      // For now, we'll let the TTL handle cleanup. In production, you might want to
      // maintain a separate index of user -> keys for efficient cleanup
      logger.info(`Cleaning up typing indicators for user ${userId} via TTL`);
    } catch (error) {
      logger.error(`Error cleaning up typing indicators for user ${userId}:`, error);
    }
  }

  /**
   * Broadcast typing update cross-pod via Redis pub/sub
   */
  async broadcastTypingUpdate(
    sessionId: string,
    typingUsers: TypingUser[],
    isChannel: boolean,
    type: 'typing_start' | 'typing_stop'
  ): Promise<void> {
    try {
      const typingMessage = {
        messageId: `typing_${Date.now()}_${Math.random()}`,
        conversationId: sessionId, // This is the sessionId where typing is happening
        senderId: 'system',
        senderName: 'System',
        content: JSON.stringify({
          type: 'typing_updated',
          data: {
            sessionId,
            typingUsers,
            isChannel,
            action: type,
            timestamp: new Date()
          }
        }),
        msgType: 'SYSTEM',
        createdAt: new Date()
      };

      logger.info(`🔤 [TYPING-BROADCAST] Broadcasting typing update for session ${sessionId}:`, {
        action: type,
        typingUsersCount: typingUsers.length,
        isChannel
      });

      // Broadcast via Redis for cross-pod delivery
      await redisService.broadcastMessageToSession(sessionId, typingMessage);
    } catch (error) {
      logger.error(`❌ [TYPING-BROADCAST] Error broadcasting typing update for session ${sessionId}:`, error);
    }
  }
}

export const typingService = new TypingService();