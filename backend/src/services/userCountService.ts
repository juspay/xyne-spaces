import { redisService } from './redisService';
import { logger } from '@/utils/logger';
import { AnalyticsRepository } from '@/database/repositories/analyticsRepository';
import { getCurrentISTDate, getTodayISTDateRange } from '@/utils/dateUtils';

// Redis keys for Set-based tracking (stores user IDs for O(1) operations)
const ACTIVE_USERS_SET_PREFIX = 'active_users_set:today:';
const ALL_TIME_ACTIVE_USERS_SET_KEY = 'active_users_set:all_time';

// Redis pub/sub channels
const USER_COUNT_CHANNEL = 'user_count:updates';
const ALL_TIME_USER_COUNT_CHANNEL = 'user_count:all_time:updates';

const USER_COUNT_EXPIRATION_SECONDS = 2 * 24 * 60 * 60; // 2 days

export interface UserCountData {
  count: number;
  date: string;
  timestamp: string;
}

export interface AllTimeUserCountData {
  count: number;
  timestamp: string;
}

class UserCountService {
  private analyticsRepository = new AnalyticsRepository();

  /**
   * Get Redis key for today's active users Set
   */
  private getTodaySetKey(): string {
    const today = getCurrentISTDate();
    return `${ACTIVE_USERS_SET_PREFIX}${today}`;
  }

  /**
   * Initialize today's active users Set from database
   */
  async initializeFromDatabase(): Promise<UserCountData> {
    try {
      const currentDate = getCurrentISTDate();
      const redis = redisService.getClient();
      const setKey = this.getTodaySetKey();
      
      // Use getActiveUsersWithChart with IST-based today's date range
      const { startDate, endDate } = getTodayISTDateRange();
      
      // Get all active user IDs from database
      const userIds = await this.analyticsRepository.getActiveUserIds({
        timeRange: 'custom',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });
      
      // Clear existing set and populate with user IDs
      await redis.del(setKey);
      if (userIds.length > 0) {
        await redis.sadd(setKey, ...userIds);
      }
      await redis.expire(setKey, USER_COUNT_EXPIRATION_SECONDS);
      
      const count = userIds.length;
      logger.info(`✅ [USER-COUNT] Initialized today's active users Set with ${count} users`);
      
      return {
        count: count,
        date: currentDate,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [USER-COUNT] Error initializing from database:', error);
      throw error;
    }
  }

  /**
   * Initialize all-time active users Set from database
   */
  async initializeAllTimeFromDatabase(): Promise<AllTimeUserCountData> {
    try {
      const redis = redisService.getClient();
      
      // Get all active user IDs from database (all-time)
      const userIds = await this.analyticsRepository.getAllTimeActiveUserIds();
      
      // Clear existing set and populate with user IDs
      await redis.del(ALL_TIME_ACTIVE_USERS_SET_KEY);
      if (userIds.length > 0) {
        await redis.sadd(ALL_TIME_ACTIVE_USERS_SET_KEY, ...userIds);
      }
      // No expiration for all-time set
      
      const count = userIds.length;
      logger.info(`✅ [USER-COUNT] Initialized all-time active users Set with ${count} users`);
      
      return {
        count: count,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [USER-COUNT] Error initializing all-time count from database:', error);
      throw error;
    }
  }

  /**
   * Get today's active user count from Redis
   * If not found, initialize from database
   */
  async getTodayCount(): Promise<UserCountData> {
    try {
      const redis = redisService.getClient();
      const currentDate = getCurrentISTDate();
      const setKey = this.getTodaySetKey();
      
      // Check if the Set exists
      const setExists = await redis.exists(setKey);
      
      if (!setExists) {
        // Initialize from database
        return await this.initializeFromDatabase();
      }
      
      // Get count from Set (O(1) operation)
      const count = await redis.scard(setKey);
      
      return {
        count: count,
        date: currentDate,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [USER-COUNT] Error getting today count:', error);
      throw error;
    }
  }

  /**
   * Get all-time active user count from Redis
   * If not found, initialize from database
   */
  async getAllTimeCount(): Promise<AllTimeUserCountData> {
    try {
      const redis = redisService.getClient();
      
      // Check if the Set exists
      const setExists = await redis.exists(ALL_TIME_ACTIVE_USERS_SET_KEY);
      
      if (!setExists) {
        // Initialize from database
        return await this.initializeAllTimeFromDatabase();
      }
      
      // Get count from Set (O(1) operation)
      const count = await redis.scard(ALL_TIME_ACTIVE_USERS_SET_KEY);
      
      return {
        count: count,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [USER-COUNT] Error getting all-time count:', error);
      throw error;
    }
  }

  /**
   * Track a user's activity - adds user to today's and all-time Sets
   * This is the optimized method that replaces refreshCounts()
   * 
   * @param userId - The ID of the user who performed an activity
   * @returns Promise<void>
   */
  async trackUserActivity(userId: string): Promise<void> {
    try {
      const redis = redisService.getClient();
      const currentDate = getCurrentISTDate();
      const setKey = this.getTodaySetKey();
      
      // Check if Sets exist, if not initialize from database
      const [todayExists, allTimeExists] = await Promise.all([
        redis.exists(setKey),
        redis.exists(ALL_TIME_ACTIVE_USERS_SET_KEY)
      ]);
      
      if (!todayExists) {
        await this.initializeFromDatabase();
      }
      
      if (!allTimeExists) {
        await this.initializeAllTimeFromDatabase();
      }
      
      // Add user to both Sets (SADD is idempotent - no duplicates)
      // These are O(1) operations
      const [todayAdded, allTimeAdded] = await Promise.all([
        redis.sadd(setKey, userId),
        redis.sadd(ALL_TIME_ACTIVE_USERS_SET_KEY, userId)
      ]);
      
      // Ensure expiration is set for today's set
      await redis.expire(setKey, USER_COUNT_EXPIRATION_SECONDS);
      
      // Only broadcast if user was actually added (new active user)
      if (todayAdded > 0 || allTimeAdded > 0) {
        // Get current counts
        const [todayCount, allTimeCount] = await Promise.all([
          redis.scard(setKey),
          redis.scard(ALL_TIME_ACTIVE_USERS_SET_KEY)
        ]);
        
        // Broadcast updates
        if (todayAdded > 0) {
          const todayData: UserCountData = {
            count: todayCount,
            date: currentDate,
            timestamp: new Date().toISOString()
          };
          await this.broadcastCountUpdate(todayData);
          logger.info(`📊 [USER-COUNT] New active user today: ${userId}, total: ${todayCount}`);
        }
        
        if (allTimeAdded > 0) {
          const allTimeData: AllTimeUserCountData = {
            count: allTimeCount,
            timestamp: new Date().toISOString()
          };
          await this.broadcastAllTimeCountUpdate(allTimeData);
          logger.info(`📊 [USER-COUNT] New all-time active user: ${userId}, total: ${allTimeCount}`);
        }
      }
    } catch (error) {
      logger.error('❌ [USER-COUNT] Error tracking user activity:', error);
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Broadcast count update via Redis pub/sub
   */
  async broadcastCountUpdate(countData: UserCountData): Promise<void> {
    try {
      await redisService.publish(USER_COUNT_CHANNEL, countData);
    } catch (error) {
      logger.error('❌ [USER-COUNT] Error broadcasting count update:', error);
    }
  }

  /**
   * Broadcast all-time count update via Redis pub/sub
   */
  private async broadcastAllTimeCountUpdate(countData: AllTimeUserCountData): Promise<void> {
    try {
      await redisService.publish(ALL_TIME_USER_COUNT_CHANNEL, countData);
    } catch (error) {
      logger.error('❌ [USER-COUNT] Error broadcasting all-time count update:', error);
    }
  }

  /**
   * Subscribe to user count updates
   */
  async subscribeToUpdates(callback: (data: UserCountData) => void): Promise<void> {
    try {
      await redisService.subscribe(USER_COUNT_CHANNEL, callback);
    } catch (error) {
      logger.error('❌ [USER-COUNT] Error subscribing to updates:', error);
      throw error;
    }
  }

  /**
   * Subscribe to all-time user count updates
   */
  async subscribeToAllTimeUpdates(callback: (data: AllTimeUserCountData) => void): Promise<void> {
    try {
      await redisService.subscribe(ALL_TIME_USER_COUNT_CHANNEL, callback);
    } catch (error) {
      logger.error('❌ [USER-COUNT] Error subscribing to all-time updates:', error);
      throw error;
    }
  }

  /**
   * Sync Redis active user counts with actual database counts
   * This should be called periodically (e.g., every hour) to reconcile any discrepancies
   * Always syncs regardless of whether values match (mandatory sync)
   */
  async syncWithDatabase(): Promise<void> {
    try {
      const redis = redisService.getClient();
      const currentDate = getCurrentISTDate();
      const setKey = this.getTodaySetKey();

      // Get actual user IDs from database using the same query as initializeFromDatabase
      const { startDate, endDate } = getTodayISTDateRange();
      const dbUserIds = await this.analyticsRepository.getActiveUserIds({
        timeRange: 'custom',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });
      const dbTodayCount = dbUserIds.length;

      logger.info(`🔄 [USER-COUNT] Mandatory sync - DB count: ${dbTodayCount}`);

      // Always update Redis with DB values (mandatory sync)
      await redis.del(setKey);
      if (dbUserIds.length > 0) {
        await redis.sadd(setKey, ...dbUserIds);
      }
      await redis.expire(setKey, USER_COUNT_EXPIRATION_SECONDS);
      
      await this.broadcastCountUpdate({
        count: dbTodayCount,
        date: currentDate,
        timestamp: new Date().toISOString()
      });
      logger.info(`✅ [USER-COUNT] Mandatory sync completed. Today: ${dbTodayCount}`);
    } catch (error) {
      logger.error('❌ [USER-COUNT] Error syncing with database:', error);
      throw error;
    }
  }

  /**
   * Sync Redis all-time active user count with actual database count
   * This should be called periodically (e.g., every 48 hours) to reconcile any discrepancies
   * Always syncs regardless of whether values match (mandatory sync)
   */
  async syncAllTimeWithDatabase(): Promise<void> {
    try {
      const redis = redisService.getClient();

      // Get actual user IDs from database using the same query as initializeAllTimeFromDatabase
      const dbUserIds = await this.analyticsRepository.getAllTimeActiveUserIds();
      const dbAllTimeCount = dbUserIds.length;

      logger.info(`🔄 [USER-COUNT] Mandatory all-time sync - DB count: ${dbAllTimeCount}`);

      // Always update Redis with DB values (mandatory sync)
      await redis.del(ALL_TIME_ACTIVE_USERS_SET_KEY);
      if (dbUserIds.length > 0) {
        await redis.sadd(ALL_TIME_ACTIVE_USERS_SET_KEY, ...dbUserIds);
      }
      
      await this.broadcastAllTimeCountUpdate({
        count: dbAllTimeCount,
        timestamp: new Date().toISOString()
      });
      logger.info(`✅ [USER-COUNT] Mandatory all-time sync completed. All-time: ${dbAllTimeCount}`);
    } catch (error) {
      logger.error('❌ [USER-COUNT] Error syncing all-time with database:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const userCountService = new UserCountService();
