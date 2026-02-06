import { redisService } from './redisService';
import { logger } from '../utils/logger';
import { DatabaseClient } from '../database/client';
import { UserPresenceStatus } from '@prisma/client';

export interface OnlineUser {
  userId: string;
  userName: string;
  userEmail?: string;
  status: UserPresenceStatus;
  lastActiveAt: string;
  deviceInfo?: string;
}

export class UserStatusService {
  // Redis TTL for ONLINE users - must be longer than heartbeat interval (30s)
  // and tolerant of browser throttling (can delay heartbeats by 60s+)
  // Setting to 180s (3 minutes) to provide enough buffer
  private readonly STATUS_TTL = 180;
  private readonly prisma = DatabaseClient.getInstance();

  // Redis key patterns
  private getOnlineUsersKey(): string {
    return 'users:online';
  }

  private getUserStatusKey(userId: string): string {
    return `user:status:${userId}`;
  }

  // Set user status and update Redis + Database
  async setUserStatus(
    userId: string,
    status: UserPresenceStatus,
    currentPresence: UserPresenceStatus | null,
    user: { userName: string; userEmail?: string; deviceInfo?: string }
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();

      const onlineUser: OnlineUser = {
        userId,
        userName: user.userName,
        userEmail: user.userEmail,
        status,
        lastActiveAt: timestamp,
        deviceInfo: user.deviceInfo
      };

      const onlineUsersKey = this.getOnlineUsersKey();
      const userStatusKey = this.getUserStatusKey(userId);

      if (status === 'ONLINE') {
        // Add to Redis with TTL (180s) - heartbeat refreshes this
        // Using direct set() to ensure key matches what exists() checks
        await redisService.set(userStatusKey, JSON.stringify(onlineUser), this.STATUS_TTL);
        await redisService.hset(onlineUsersKey, userId, JSON.stringify(onlineUser));
        await redisService.expire(onlineUsersKey, this.STATUS_TTL);
      } else if (status === 'AWAY') {
        // Add to Redis WITHOUT TTL - AWAY persists until manually changed
        await redisService.set(userStatusKey, JSON.stringify(onlineUser)); // No TTL!
        await redisService.hdel(onlineUsersKey, userId); // Not in "online users" hash
      } else if (status === 'OFFLINE') {
        // Remove from Redis completely
        await redisService.del(userStatusKey);
        await redisService.hdel(onlineUsersKey, userId);
      }

      if(currentPresence !== status) {  

        // // Update database (upsert)
        // await this.prisma.userPresence.upsert({
        //   where: { userId },
        //   update: {
        //     status,
        //     deviceInfo: user.deviceInfo,
        //   },
        //   create: {
        //     userId,
        //     status,
        //     lastActiveAt: new Date(timestamp),
        //     lastSeenAt: new Date(timestamp),
        //     deviceInfo: user.deviceInfo
        //   }
        // });
      }

      logger.info(`👤 [USER-STATUS] User ${user.userName} (${userId}) status updated to ${status}`);

    } catch (error) {
      logger.error('❌ [USER-STATUS] Error setting user status:', error);
      throw error;
    }
  }

  // Get user's current status
  async getUserStatus(userId: string): Promise<OnlineUser | null> {
    try {
      // Try Redis first - using direct get() to match set() key format
      const userStatusKey = this.getUserStatusKey(userId);
      const cachedStatus = await redisService.get(userStatusKey);

      if (cachedStatus) {
        return JSON.parse(cachedStatus);
      }

      // Fallback to database
      const dbStatus = await this.prisma.userPresence.findUnique({
        where: { userId },
        include: { user: true }
      });

      if (dbStatus) {
        const onlineUser: OnlineUser = {
          userId: dbStatus.userId,
          userName: dbStatus.user.name,
          userEmail: dbStatus.user.email,
          status: dbStatus.status,
          lastActiveAt: dbStatus.lastActiveAt.toISOString(),
          deviceInfo: dbStatus.deviceInfo || undefined
        };

        // Only cache ONLINE/AWAY to Redis, NOT OFFLINE
        // OFFLINE users should not be cached - they need self-healing via heartbeat
        if (dbStatus.status !== 'OFFLINE') {
          await redisService.set(userStatusKey, JSON.stringify(onlineUser), this.STATUS_TTL);
        }
        return onlineUser;
      }

      return null;
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error getting user status:', error);
      return null;
    }
  }

  // Get all online users
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

  // Mark user as offline
  async markUserOffline(userId: string): Promise<void> {
    try {
      // Get user info for logging
      const currentStatus = await this.getUserStatus(userId);

      // Remove from Redis online users
      const onlineUsersKey = this.getOnlineUsersKey();
      const userStatusKey = this.getUserStatusKey(userId);

      await redisService.hdel(onlineUsersKey, userId);
      await redisService.del(userStatusKey);

      // Update database
      // await this.prisma.userPresence.upsert({
      //   where: { userId },
      //   update: {
      //     status: 'OFFLINE',
      //     lastSeenAt: new Date(),
      //     updatedAt: new Date()
      //   },
      //   create: {
      //     userId,
      //     status: 'OFFLINE',
      //     lastActiveAt: new Date(),
      //     lastSeenAt: new Date()
      //   }
      // });

      if (currentStatus) {
        logger.info(`👤 [USER-STATUS] User ${currentStatus.userName} (${userId}) marked as OFFLINE`);
      }
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error marking user offline:', error);
    }
  }

  // Update user activity (extends online time) - called on every heartbeat
  async updateUserActivity(userId: string, deviceInfo?: string): Promise<void> {
    try {
      const currentStatus = await this.getUserStatus(userId); // Reads from Redis first, falls back to DB
      
      // Case 1: User is AWAY in Redis → ignore heartbeat (AWAY is manual, persists)
      if (currentStatus?.status === 'AWAY') {
        logger.debug(`[USER-STATUS] Heartbeat from AWAY user ${userId} - ignoring`);
        return;
      }
      
      // Case 2: User is ONLINE in Redis → fast path (just refresh TTL, no DB writes)
      if (currentStatus?.status === 'ONLINE') {
        const userStatusKey = this.getUserStatusKey(userId);
        const onlineUsersKey = this.getOnlineUsersKey();
        
        // Only refresh TTL - don't overwrite values (performance optimization)
        // Avoids JSON serialization and full SET/HSET on every 30s heartbeat
        await redisService.expire(userStatusKey, this.STATUS_TTL);
        await redisService.expire(onlineUsersKey, this.STATUS_TTL);
        return;
      }
      
      // Case 3: User not in Redis OR status is OFFLINE → self-healing
      // Heartbeat = user has tab open → restore to ONLINE
      logger.warn(`⚠️ [USER-STATUS] Self-healing: User ${userId} not in Redis or OFFLINE - restoring to ONLINE`);
      
      // Need to get user info from DB for self-healing (this is rare, acceptable)
      const dbPresence = await this.prisma.userPresence.findUnique({
        where: { userId },
        include: { user: true }
      });
      
      if (!dbPresence) {
        logger.error(`[USER-STATUS] Cannot self-heal user ${userId} - not found in database`);
        return;
      }
      
      // Double-check: If user is AWAY in DB, don't override (edge case: AWAY not cached to Redis)
      if (dbPresence.status === 'AWAY') {
        logger.debug(`[USER-STATUS] User ${userId} is AWAY in DB - not restoring to ONLINE`);
        return;
      }
      
      const userInfo = {
        userName: dbPresence.user.name,
        userEmail: dbPresence.user.email,
        deviceInfo: deviceInfo || 'Unknown'
      };
      
      // Set user back to ONLINE (this will add to Redis and update DB)
      await this.setUserStatus(userId, 'ONLINE', dbPresence.status, userInfo);
      
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error updating user activity:', error);
    }
  }

  // Get users by status
  async getUsersByStatus(status: UserPresenceStatus): Promise<OnlineUser[]> {
    try {
      const allOnlineUsers = await this.getOnlineUsers();
      return allOnlineUsers.filter(user => user.status === status);
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error getting users by status:', error);
      return [];
    }
  }

  // Cleanup inactive users (run periodically by Bull queue every 5 minutes)
  // Users are marked offline if their Redis key has expired (no heartbeat for 180s)
  // The 5-minute cleanup interval acts as the grace period
  async cleanupInactiveUsers(): Promise<number> {
    try {
      // Get all users marked ONLINE in database
      const onlineUsersInDB = await this.prisma.userPresence.findMany({
        where: { status: 'ONLINE' },
        include: { user: true }
      });
      
      let cleanedCount = 0;
      const cleanedUsers: string[] = [];
      
      logger.info(`🧹 [USER-STATUS] Checking ${onlineUsersInDB.length} ONLINE users in database`);
      
      for (const dbUser of onlineUsersInDB) {
        // Check if user still exists in Redis (active connection)
        const userStatusKey = this.getUserStatusKey(dbUser.userId);
        const existsInRedis = await redisService.exists(userStatusKey);
        
        if (!existsInRedis) {
          // Redis key expired (no heartbeat for 180s) - mark offline
          // Self-healing via heartbeat will restore if user still has tab open
          await this.markUserOffline(dbUser.userId);
          cleanedCount++;
          cleanedUsers.push(`${dbUser.user.name} (${dbUser.userId})`);
        }
      }
      
      if (cleanedCount > 0) {
        logger.info(`🧹 [USER-STATUS] Cleaned up ${cleanedCount} inactive users: ${cleanedUsers.join(', ')}`);
      } else {
        logger.info(`🧹 [USER-STATUS] No inactive users found to clean up`);
      }
      
      return cleanedCount;
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error cleaning up inactive users:', error);
      return 0;
    }
  }

  // Force cleanup users with stale connections (debug method)
  async forceCleanupStaleUsers(): Promise<number> {
    try {
      logger.info(`🔧 [DEBUG] Force cleaning stale users...`);

      // Get Redis online users
      const redisOnlineUsers = await this.getOnlineUsers();

      // Check each user's WebSocket connections
      let cleanedCount = 0;

      for (const user of redisOnlineUsers) {
        // Import redisService to check connections
        const { redisService } = await import('./redisService');
        const connections = await redisService.getUserConnections(user.userId);

        if (connections.length === 0) {
          logger.info(`🔧 [DEBUG] User ${user.userName} has no active connections but is marked online - cleaning up`);
          await this.markUserOffline(user.userId);
          cleanedCount++;
        } else {
          logger.info(`🔧 [DEBUG] User ${user.userName} has ${connections.length} active connections: [${connections.join(', ')}]`);
        }
      }

      logger.info(`🔧 [DEBUG] Force cleanup completed: ${cleanedCount} users cleaned`);
      return cleanedCount;
    } catch (error) {
      logger.error('❌ [DEBUG] Error in force cleanup:', error);
      return 0;
    }
  }

  // Get online count
  async getOnlineCount(): Promise<number> {
    try {
      const onlineUsers = await this.getUsersByStatus('ONLINE');
      return onlineUsers.length;
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error getting online count:', error);
      return 0;
    }
  }

  // Get presence stats
  async getPresenceStats(): Promise<{
    online: number;
    away: number;
    offline: number;
    total: number;
  }> {
    try {
      const onlineUsers = await this.getOnlineUsers();

      const stats = {
        online: onlineUsers.filter(u => u.status === 'ONLINE').length,
        away: onlineUsers.filter(u => u.status === 'AWAY').length,
        offline: 0, // We don't track offline users in Redis
        total: onlineUsers.length
      };

      return stats;
    } catch (error) {
      logger.error('❌ [USER-STATUS] Error getting presence stats:', error);
      return { online: 0, away: 0, offline: 0, total: 0 };
    }
  }
}

// Export singleton instance
export const userStatusService = new UserStatusService();