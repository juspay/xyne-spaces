import { redisService } from './redisService';
import { logger } from '@/utils/logger';
import { AnalyticsRepository } from '@/database/repositories/analyticsRepository';
import { getCurrentISTDate } from '@/utils/dateUtils';

const MESSAGE_COUNT_KEY_PREFIX = 'message_count:';
const ALL_TIME_MESSAGE_COUNT_KEY = 'message_count:all_time';
const MESSAGE_COUNT_CHANNEL = 'message_count:updates';
const ALL_TIME_MESSAGE_COUNT_CHANNEL = 'message_count:all_time:updates';
const MESSAGE_COUNT_EXPIRATION_SECONDS = 2 * 24 * 60 * 60; // 2 days

export interface MessageCountData {
  count: number;
  date: string;
  timestamp: string;
}

export interface AllTimeMessageCountData {
  count: number;
  timestamp: string;
}

class MessageCountService {
  private analyticsRepository = new AnalyticsRepository();

  /**
   * Get Redis key for today's message count
   */
  private getTodayKey(): string {
    const today = getCurrentISTDate();
    return `${MESSAGE_COUNT_KEY_PREFIX}${today}`;
  }

  /**
   * Initialize today's message count from database
   */
  async initializeFromDatabase(): Promise<MessageCountData> {
    try {
      const count = await this.analyticsRepository.getMessagesToday();
      const currentDate = getCurrentISTDate();
      
      const key = this.getTodayKey();
      const redis = redisService.getClient();
      
      // Set the count in Redis with expiration
      await redis.set(key, count.toString(), 'EX', MESSAGE_COUNT_EXPIRATION_SECONDS);
      
      return {
        count: count,
        date: currentDate,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [MESSAGE-COUNT] Error initializing from database:', error);
      throw error;
    }
  }

  /**
   * Initialize all-time message count from database
   */
  async initializeAllTimeFromDatabase(): Promise<AllTimeMessageCountData> {
    try {
      // Fetch all-time message count using direct count query
      const count = await this.analyticsRepository.getAllTimeMessageCount();
      
      const redis = redisService.getClient();
      
      // Set the count in Redis (no expiration for all-time counter)
      await redis.set(ALL_TIME_MESSAGE_COUNT_KEY, count.toString());
      
      return {
        count: count,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [MESSAGE-COUNT] Error initializing all-time count from database:', error);
      throw error;
    }
  }

  /**
   * Get today's message count from Redis
   * If not found, initialize from database
   */
  async getTodayCount(): Promise<MessageCountData> {
    try {
      const key = this.getTodayKey();
      const redis = redisService.getClient();
      const currentDate = getCurrentISTDate();
      
      let count = await redis.get(key);
      
      // If count doesn't exist in Redis, initialize from database
      if (count === null) {
        return await this.initializeFromDatabase();
      }
      
      return {
        count: parseInt(count, 10),
        date: currentDate,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [MESSAGE-COUNT] Error getting today count:', error);
      throw error;
    }
  }

  /**
   * Get all-time message count from Redis
   * If not found, initialize from database
   */
  async getAllTimeCount(): Promise<AllTimeMessageCountData> {
    try {
      const redis = redisService.getClient();
      
      let count = await redis.get(ALL_TIME_MESSAGE_COUNT_KEY);
      
      // If count doesn't exist in Redis, initialize from database
      if (count === null) {
        return await this.initializeAllTimeFromDatabase();
      }
      
      return {
        count: parseInt(count, 10),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [MESSAGE-COUNT] Error getting all-time count:', error);
      throw error;
    }
  }

  /**
   * Increment today's message count in Redis
   * Also increments all-time message count
   * Uses atomic INCR operation to avoid race conditions
   */
  async incrementCount(): Promise<MessageCountData> {
    try {
      const key = this.getTodayKey();
      const redis = redisService.getClient();
      const currentDate = getCurrentISTDate();
      
      // Check if today's key exists, if not initialize from database first
      const todayExists = await redis.exists(key);
      if (!todayExists) {
        await this.initializeFromDatabase();
      }
      
      // Check if all-time key exists, if not initialize from database first
      const allTimeExists = await redis.exists(ALL_TIME_MESSAGE_COUNT_KEY);
      if (!allTimeExists) {
        await this.initializeAllTimeFromDatabase();
      }
      
      // Now atomically increment both counters
      const newCount = await redis.incr(key);
      const allTimeCount = await redis.incr(ALL_TIME_MESSAGE_COUNT_KEY);
      
      // Ensure expiration is set for today's key
      await redis.expire(key, MESSAGE_COUNT_EXPIRATION_SECONDS);
      
      const countData: MessageCountData = {
        count: newCount,
        date: currentDate,
        timestamp: new Date().toISOString()
      };
      
      // Broadcast the updates via Redis pub/sub
      await this.broadcastCountUpdate(countData);
      await this.broadcastAllTimeCountUpdate({ count: allTimeCount, timestamp: new Date().toISOString() });
      
      return countData;
    } catch (error) {
      logger.error('❌ [MESSAGE-COUNT] Error incrementing count:', error);
      throw error;
    }
  }

  /**
   * Broadcast all-time count update via Redis pub/sub
   */
  private async broadcastAllTimeCountUpdate(countData: AllTimeMessageCountData): Promise<void> {
    try {
      await redisService.publish(ALL_TIME_MESSAGE_COUNT_CHANNEL, countData);
    } catch (error) {
      logger.error('❌ [MESSAGE-COUNT] Error broadcasting all-time count update:', error);
    }
  }

  /**
   * Broadcast count update via Redis pub/sub
   */
  async broadcastCountUpdate(countData: MessageCountData): Promise<void> {
    try {
      await redisService.publish(MESSAGE_COUNT_CHANNEL, countData);
    } catch (error) {
      logger.error('❌ [MESSAGE-COUNT] Error broadcasting count update:', error);
    }
  }

  /**
   * Subscribe to message count updates
   */
  async subscribeToUpdates(callback: (data: MessageCountData) => void): Promise<void> {
    try {
      await redisService.subscribe(MESSAGE_COUNT_CHANNEL, callback);
    } catch (error) {
      logger.error('❌ [MESSAGE-COUNT] Error subscribing to updates:', error);
      throw error;
    }
  }

  /**
   * Subscribe to all-time message count updates
   */
  async subscribeToAllTimeUpdates(callback: (data: AllTimeMessageCountData) => void): Promise<void> {
    try {
      await redisService.subscribe(ALL_TIME_MESSAGE_COUNT_CHANNEL, callback);
    } catch (error) {
      logger.error('❌ [MESSAGE-COUNT] Error subscribing to all-time updates:', error);
      throw error;
    }
  }

  /**
   * Sync Redis message counts with actual database counts
   * This should be called periodically (e.g., every hour) to reconcile any discrepancies
   * Always syncs regardless of whether values match (mandatory sync)
   */
  async syncWithDatabase(): Promise<void> {
    try {
      const redis = redisService.getClient();
      const currentDate = getCurrentISTDate();
      const todayKey = this.getTodayKey();

      // Get actual count from database
      const dbTodayCount = await this.analyticsRepository.getMessagesToday();

      logger.info(`🔄 [MESSAGE-COUNT] Mandatory sync - DB count: ${dbTodayCount}`);

      // Always update Redis with DB value (mandatory sync)
      await redis.set(todayKey, dbTodayCount.toString(), 'EX', MESSAGE_COUNT_EXPIRATION_SECONDS);
      await this.broadcastCountUpdate({
        count: dbTodayCount,
        date: currentDate,
        timestamp: new Date().toISOString()
      });
      logger.info(`✅ [MESSAGE-COUNT] Mandatory sync completed. Today: ${dbTodayCount}`);
    } catch (error) {
      logger.error('❌ [MESSAGE-COUNT] Error syncing with database:', error);
      throw error;
    }
  }

  /**
   * Sync Redis all-time message count with actual database count
   * This should be called periodically (e.g., every 48 hours) to reconcile any discrepancies
   * Always syncs regardless of whether values match (mandatory sync)
   */
  async syncAllTimeWithDatabase(): Promise<void> {
    try {
      const redis = redisService.getClient();

      // Get actual count from database using the same query as initializeAllTimeFromDatabase
      const dbAllTimeCount = await this.analyticsRepository.getAllTimeMessageCount();

      logger.info(`🔄 [MESSAGE-COUNT] Mandatory all-time sync - DB count: ${dbAllTimeCount}`);

      // Always update Redis with DB value (mandatory sync)
      await redis.set(ALL_TIME_MESSAGE_COUNT_KEY, dbAllTimeCount.toString());
      await this.broadcastAllTimeCountUpdate({
        count: dbAllTimeCount,
        timestamp: new Date().toISOString()
      });
      logger.info(`✅ [MESSAGE-COUNT] Mandatory all-time sync completed. All-time: ${dbAllTimeCount}`);
    } catch (error) {
      logger.error('❌ [MESSAGE-COUNT] Error syncing all-time with database:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const messageCountService = new MessageCountService();