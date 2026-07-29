import { redisService, PresenceEvent } from './redisService';
import { logger } from '../utils/logger';
import { UserPresenceStatus } from '@prisma/client';

export interface OnlineUser {
  userId: string;
  status: UserPresenceStatus;
}

export class UserStatusService {
  // Redis key for all user statuses (single hash)
  private getOnlineUsersKey(): string {
    return 'users:online';
  }

  /**
   * Set user online/away/offline status - Redis + Socket.IO ONLY (no DB writes)
   * 
   * NOTE: Online/Away/Offline status is transient and managed via:
   * - Redis hash for fast lookups (single key for all users)
   * - Socket.IO disconnect handles cleanup (no TTL needed)
   * 
   * Status emoji/text/expiry is managed separately via Zero (writes to DB)
   */
  async setUserStatus(
    userId: string,
    status: UserPresenceStatus
  ): Promise<OnlineUser[]> {
    try {
      const onlineUsersKey = this.getOnlineUsersKey();

      const currentStatus = await this.getUserStatus(userId);
      const hasChanged = !currentStatus || currentStatus.status !== status;

      if (status === 'OFFLINE') {
        // Remove from Redis hash
        await redisService.hdel(onlineUsersKey, userId);
      } else {
        // ONLINE or AWAY - store in hash
        const onlineUser: OnlineUser = { userId, status };
        await redisService.hset(onlineUsersKey, userId, JSON.stringify(onlineUser));
      }

      if (hasChanged) {
        // Broadcast presence change via Redis Pub/Sub (for multi-server support)
        const presenceEvent: PresenceEvent = { userId, status };
        await redisService.broadcastPresenceEvent(presenceEvent);
        logger.info(`👤 [USER-STATUS] User ${userId} status updated to ${status}`);
      } else {
        logger.debug(`👤 [USER-STATUS] User ${userId} status remained ${status}, skipping broadcast`);
      }

      return await this.getOnlineUsers();
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error setting user status:', error);
      throw error;
    }
  }

  /**
   * Get user's current status from Redis hash
   */
  async getUserStatus(userId: string): Promise<OnlineUser | null> {
    try {
      const onlineUsersKey = this.getOnlineUsersKey();
      const userData = await redisService.getHashField(onlineUsersKey, userId);

      if (userData) {
        return JSON.parse(userData);
      }

      // User not in Redis = OFFLINE
      return null;
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error getting user status:', error);
      return null;
    }
  }

  /**
   * Get all online/away users from Redis hash
   */
  async getOnlineUsers(): Promise<OnlineUser[]> {
    try {
      const onlineUsersKey = this.getOnlineUsersKey();
      const onlineUsersData = await redisService.hgetall(onlineUsersKey);

      const onlineUsers: OnlineUser[] = [];

      for (const [userId, userData] of Object.entries(onlineUsersData)) {
        try {
          const user = JSON.parse(userData);
          onlineUsers.push(user);
        } catch (parseError) {
          logger.error(`❌ [USER-STATUS] Error parsing user data for ${userId}:`, parseError);
        }
      }

      return onlineUsers;
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error getting online users:', error);
      return [];
    }
  }

  /**
   * Mark user as offline - called by socket disconnect handler
   * NOTE: Does not affect AWAY users - AWAY is a manual status that persists
   */
  async markUserOffline(userId: string): Promise<void> {
    try {
      const currentStatus = await this.getUserStatus(userId);

      // If user is AWAY, don't change their status - AWAY persists until manually changed
      if (currentStatus?.status === 'AWAY') {
        logger.info(`👤 [USER-STATUS] User ${userId} is AWAY, not marking offline`);
        return;
      }

      if (!currentStatus) {
        logger.debug(`👤 [USER-STATUS] User ${userId} is already OFFLINE, skipping broadcast`);
        return;
      }

      // Remove from Redis hash
      const onlineUsersKey = this.getOnlineUsersKey();
      await redisService.hdel(onlineUsersKey, userId);

      // Broadcast OFFLINE status via Redis Pub/Sub
      const presenceEvent: PresenceEvent = { userId, status: 'OFFLINE' };
      await redisService.broadcastPresenceEvent(presenceEvent);

      logger.info(`👤 [USER-STATUS] User ${userId} marked as OFFLINE`);
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error marking user offline:', error);
    }
  }

  /**
   * Get users by status from Redis
   */
  async getUsersByStatus(status: UserPresenceStatus): Promise<OnlineUser[]> {
    try {
      const allOnlineUsers = await this.getOnlineUsers();
      return allOnlineUsers.filter(user => user.status === status);
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error getting users by status:', error);
      return [];
    }
  }

  /**
   * Safety net cleanup - removes users from Redis who have no active socket connections
   * This handles edge cases where socket disconnect didn't fire properly
   */
  async cleanupInactiveUsers(): Promise<number> {
    try {
      const onlineUsers = await this.getOnlineUsers();
      let cleanedCount = 0;

      for (const user of onlineUsers) {
        // Skip AWAY users - they persist without connections
        if (user.status === 'AWAY') {
          continue;
        }

        const connections = await redisService.getUserConnections(user.userId);

        if (connections.length === 0) {
          logger.info(`🧹 [USER-STATUS] User ${user.userId} has no connections - cleaning up`);
          await this.markUserOffline(user.userId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info(`🧹 [USER-STATUS] Cleaned up ${cleanedCount} stale users`);
      }

      return cleanedCount;
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error cleaning up inactive users:', error);
      return 0;
    }
  }

  /**
   * Get online count from Redis
   */
  async getOnlineCount(): Promise<number> {
    try {
      const onlineUsers = await this.getUsersByStatus('ONLINE');
      return onlineUsers.length;
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error getting online count:', error);
      return 0;
    }
  }

  /**
   * Get presence stats from Redis
   */
  async getPresenceStats(): Promise<{
    online: number;
    away: number;
    offline: number;
    total: number;
  }> {
    try {
      const onlineUsers = await this.getOnlineUsers();

      return {
        online: onlineUsers.filter(u => u.status === 'ONLINE').length,
        away: onlineUsers.filter(u => u.status === 'AWAY').length,
        offline: 0, // We don't track offline users in Redis
        total: onlineUsers.length
      };
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error getting presence stats:', error);
      return { online: 0, away: 0, offline: 0, total: 0 };
    }
  }
}

// Export singleton instance
export const userStatusService = new UserStatusService();
