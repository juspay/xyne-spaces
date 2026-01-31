import { redisService } from './redisService';
import { logger } from '@/utils/logger';
import { AnalyticsRepository } from '@/database/repositories/analyticsRepository';
import { getCurrentISTDate } from '@/utils/dateUtils';

const CALL_COUNT_KEY_PREFIX = 'call_count:';
const ALL_TIME_CALL_COUNT_KEY = 'call_count:all_time';
const CALL_COUNT_CHANNEL = 'call_count:updates';
const ALL_TIME_CALL_COUNT_CHANNEL = 'call_count:all_time:updates';
const CALL_COUNT_EXPIRATION_SECONDS = 2 * 24 * 60 * 60; // 2 days

// Call duration Redis keys and channels
const CALL_DURATION_KEY_PREFIX = 'call_duration:';
const ALL_TIME_CALL_DURATION_KEY = 'call_duration:all_time';
const CALL_DURATION_CHANNEL = 'call_duration:updates';
const ALL_TIME_CALL_DURATION_CHANNEL = 'call_duration:all_time:updates';
const CALL_DURATION_EXPIRATION_SECONDS = 2 * 24 * 60 * 60; // 2 days

export interface CallCountData {
  count: number;
  date: string;
  timestamp: string;
}

export interface AllTimeCallCountData {
  count: number;
  timestamp: string;
}

export interface CallDurationData {
  duration: number; // in minutes
  date: string;
  timestamp: string;
}

export interface AllTimeCallDurationData {
  duration: number; // in minutes
  timestamp: string;
}

class CallCountService {
  private analyticsRepository = new AnalyticsRepository();

  /**
   * Get Redis key for today's call count
   */
  private getTodayKey(): string {
    const today = getCurrentISTDate();
    return `${CALL_COUNT_KEY_PREFIX}${today}`;
  }

  /**
   * Get Redis key for today's call duration
   */
  private getTodayDurationKey(): string {
    const today = getCurrentISTDate();
    return `${CALL_DURATION_KEY_PREFIX}${today}`;
  }

  /**
   * Initialize today's call count from database
   */
  async initializeFromDatabase(): Promise<CallCountData> {
    try {
      const count = await this.analyticsRepository.getCallsToday();
      const currentDate = getCurrentISTDate();
      
      const key = this.getTodayKey();
      const redis = redisService.getClient();
      
      // Set the count in Redis with expiration
      await redis.set(key, count.toString(), 'EX', CALL_COUNT_EXPIRATION_SECONDS);
      
      return {
        count: count,
        date: currentDate,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [CALL-COUNT] Error initializing from database:', error);
      throw error;
    }
  }

  /**
   * Initialize all-time call count from database
   */
  async initializeAllTimeFromDatabase(): Promise<AllTimeCallCountData> {
    try {
      // Fetch all-time call count using direct count query
      const count = await this.analyticsRepository.getAllTimeCallCount();
      
      const redis = redisService.getClient();
      
      // Set the count in Redis (no expiration for all-time counter)
      await redis.set(ALL_TIME_CALL_COUNT_KEY, count.toString());
      
      return {
        count: count,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [CALL-COUNT] Error initializing all-time count from database:', error);
      throw error;
    }
  }

  /**
   * Get today's call count from Redis
   * If not found, initialize from database
   */
  async getTodayCount(): Promise<CallCountData> {
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
      logger.error('❌ [CALL-COUNT] Error getting today count:', error);
      throw error;
    }
  }

  /**
   * Get all-time call count from Redis
   * If not found, initialize from database
   */
  async getAllTimeCount(): Promise<AllTimeCallCountData> {
    try {
      const redis = redisService.getClient();
      
      let count = await redis.get(ALL_TIME_CALL_COUNT_KEY);
      
      // If count doesn't exist in Redis, initialize from database
      if (count === null) {
        return await this.initializeAllTimeFromDatabase();
      }
      
      return {
        count: parseInt(count, 10),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [CALL-COUNT] Error getting all-time count:', error);
      throw error;
    }
  }

  /**
   * Increment today's call count in Redis
   * Also increments all-time call count
   * Uses atomic INCR operation to avoid race conditions
   */
  async incrementCount(): Promise<CallCountData> {
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
      const allTimeExists = await redis.exists(ALL_TIME_CALL_COUNT_KEY);
      if (!allTimeExists) {
        await this.initializeAllTimeFromDatabase();
      }
      
      // Now atomically increment both counters
      const newCount = await redis.incr(key);
      const allTimeCount = await redis.incr(ALL_TIME_CALL_COUNT_KEY);
      
      // Ensure expiration is set for today's key
      await redis.expire(key, CALL_COUNT_EXPIRATION_SECONDS);
      
      const countData: CallCountData = {
        count: newCount,
        date: currentDate,
        timestamp: new Date().toISOString()
      };
      
      // Broadcast the updates via Redis pub/sub
      await this.broadcastCountUpdate(countData);
      await this.broadcastAllTimeCountUpdate({ count: allTimeCount, timestamp: new Date().toISOString() });
      
      return countData;
    } catch (error) {
      logger.error('❌ [CALL-COUNT] Error incrementing count:', error);
      throw error;
    }
  }

  /**
   * Broadcast all-time count update via Redis pub/sub
   */
  private async broadcastAllTimeCountUpdate(countData: AllTimeCallCountData): Promise<void> {
    try {
      await redisService.publish(ALL_TIME_CALL_COUNT_CHANNEL, countData);
    } catch (error) {
      logger.error('❌ [CALL-COUNT] Error broadcasting all-time count update:', error);
    }
  }

  /**
   * Broadcast count update via Redis pub/sub
   */
  async broadcastCountUpdate(countData: CallCountData): Promise<void> {
    try {
      await redisService.publish(CALL_COUNT_CHANNEL, countData);
    } catch (error) {
      logger.error('❌ [CALL-COUNT] Error broadcasting count update:', error);
    }
  }

  /**
   * Subscribe to call count updates
   */
  async subscribeToUpdates(callback: (data: CallCountData) => void): Promise<void> {
    try {
      await redisService.subscribe(CALL_COUNT_CHANNEL, callback);
    } catch (error) {
      logger.error('❌ [CALL-COUNT] Error subscribing to updates:', error);
      throw error;
    }
  }

  /**
   * Subscribe to all-time call count updates
   */
  async subscribeToAllTimeUpdates(callback: (data: AllTimeCallCountData) => void): Promise<void> {
    try {
      await redisService.subscribe(ALL_TIME_CALL_COUNT_CHANNEL, callback);
    } catch (error) {
      logger.error('❌ [CALL-COUNT] Error subscribing to all-time updates:', error);
      throw error;
    }
  }

  /**
   * Sync Redis call counts with actual database counts
   * This should be called periodically (e.g., every hour) to reconcile any discrepancies
   * Always syncs regardless of whether values match (mandatory sync)
   */
  async syncWithDatabase(): Promise<void> {
    try {
      const redis = redisService.getClient();
      const currentDate = getCurrentISTDate();
      const todayKey = this.getTodayKey();

      // Get actual count from database using the same query as initializeFromDatabase
      const dbTodayCount = await this.analyticsRepository.getCallsToday();

      logger.info(`🔄 [CALL-COUNT] Mandatory sync - DB count: ${dbTodayCount}`);

      // Always update Redis with DB value (mandatory sync)
      await redis.set(todayKey, dbTodayCount.toString(), 'EX', CALL_COUNT_EXPIRATION_SECONDS);
      await this.broadcastCountUpdate({
        count: dbTodayCount,
        date: currentDate,
        timestamp: new Date().toISOString()
      });
      logger.info(`✅ [CALL-COUNT] Mandatory sync completed. Today: ${dbTodayCount}`);
    } catch (error) {
      logger.error('❌ [CALL-COUNT] Error syncing with database:', error);
      throw error;
    }
  }

  /**
   * Sync Redis all-time call count with actual database count
   * This should be called periodically (e.g., every 48 hours) to reconcile any discrepancies
   * Always syncs regardless of whether values match (mandatory sync)
   */
  async syncAllTimeWithDatabase(): Promise<void> {
    try {
      const redis = redisService.getClient();

      // Get actual count from database using the same query as initializeAllTimeFromDatabase
      const dbAllTimeCount = await this.analyticsRepository.getAllTimeCallCount();

      logger.info(`🔄 [CALL-COUNT] Mandatory all-time sync - DB count: ${dbAllTimeCount}`);

      // Always update Redis with DB value (mandatory sync)
      await redis.set(ALL_TIME_CALL_COUNT_KEY, dbAllTimeCount.toString());
      await this.broadcastAllTimeCountUpdate({
        count: dbAllTimeCount,
        timestamp: new Date().toISOString()
      });
      logger.info(`✅ [CALL-COUNT] Mandatory all-time sync completed. All-time: ${dbAllTimeCount}`);
    } catch (error) {
      logger.error('❌ [CALL-COUNT] Error syncing all-time with database:', error);
      throw error;
    }
  }

  // ==================== CALL DURATION METHODS ====================

  /**
   * Initialize today's call duration from database
   */
  async initializeDurationFromDatabase(): Promise<CallDurationData> {
    try {
      const duration = await this.analyticsRepository.getCallDurationToday();
      const currentDate = getCurrentISTDate();
      
      const key = this.getTodayDurationKey();
      const redis = redisService.getClient();
      
      // Set the duration in Redis with expiration (store as string with decimal)
      await redis.set(key, duration.toString(), 'EX', CALL_DURATION_EXPIRATION_SECONDS);
      
      return {
        duration: duration,
        date: currentDate,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [CALL-DURATION] Error initializing from database:', error);
      throw error;
    }
  }

  /**
   * Initialize all-time call duration from database
   */
  async initializeAllTimeDurationFromDatabase(): Promise<AllTimeCallDurationData> {
    try {
      const duration = await this.analyticsRepository.getAllTimeCallDuration();
      
      const redis = redisService.getClient();
      
      // Set the duration in Redis (no expiration for all-time)
      await redis.set(ALL_TIME_CALL_DURATION_KEY, duration.toString());
      
      return {
        duration: duration,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [CALL-DURATION] Error initializing all-time duration from database:', error);
      throw error;
    }
  }

  /**
   * Get today's call duration from Redis
   * If not found, initialize from database
   */
  async getTodayDuration(): Promise<CallDurationData> {
    try {
      const key = this.getTodayDurationKey();
      const redis = redisService.getClient();
      const currentDate = getCurrentISTDate();
      
      const duration = await redis.get(key);
      
      // If duration doesn't exist in Redis, initialize from database
      if (duration === null) {
        return await this.initializeDurationFromDatabase();
      }
      
      return {
        duration: parseFloat(duration),
        date: currentDate,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [CALL-DURATION] Error getting today duration:', error);
      throw error;
    }
  }

  /**
   * Get all-time call duration from Redis
   * If not found, initialize from database
   */
  async getAllTimeDuration(): Promise<AllTimeCallDurationData> {
    try {
      const redis = redisService.getClient();
      
      const duration = await redis.get(ALL_TIME_CALL_DURATION_KEY);
      
      // If duration doesn't exist in Redis, initialize from database
      if (duration === null) {
        return await this.initializeAllTimeDurationFromDatabase();
      }
      
      return {
        duration: parseFloat(duration),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [CALL-DURATION] Error getting all-time duration:', error);
      throw error;
    }
  }

  /**
   * Add call duration to today's and all-time duration in Redis
   * Uses INCRBYFLOAT for atomic floating point operations
   * 
   * @param durationMinutes - The duration to add in minutes
   */
  async addCallDuration(durationMinutes: number): Promise<CallDurationData> {
    try {
      const key = this.getTodayDurationKey();
      const redis = redisService.getClient();
      const currentDate = getCurrentISTDate();
      
      // Use atomic SET NX operation instead of exists check to prevent race conditions
      const todaySetResult = await redis.set(key, '0', 'EX', CALL_DURATION_EXPIRATION_SECONDS, 'NX');
      if (todaySetResult === 'OK') {
        // Key was created, now initialize from database
        await this.initializeDurationFromDatabase();
      }
      
      // Same for all-time key
      const allTimeSetResult = await redis.set(ALL_TIME_CALL_DURATION_KEY, '0', 'NX');
      if (allTimeSetResult === 'OK') {
        await this.initializeAllTimeDurationFromDatabase();
      }
      
      // Atomically increment both duration counters using INCRBYFLOAT
      const newTodayDuration = await redis.incrbyfloat(key, durationMinutes);
      const newAllTimeDuration = await redis.incrbyfloat(ALL_TIME_CALL_DURATION_KEY, durationMinutes);

      // Ensure expiration is set for today's key
      await redis.expire(key, CALL_DURATION_EXPIRATION_SECONDS);

      // Convert to number and round to 1 decimal place for consistency
      const roundedTodayDuration = Math.round(parseFloat(newTodayDuration) * 10) / 10;
      const roundedAllTimeDuration = Math.round(parseFloat(newAllTimeDuration) * 10) / 10;
      
      const durationData: CallDurationData = {
        duration: roundedTodayDuration,
        date: currentDate,
        timestamp: new Date().toISOString()
      };
      
      // Broadcast the updates via Redis pub/sub
      await this.broadcastDurationUpdate(durationData);
      await this.broadcastAllTimeDurationUpdate({ 
        duration: roundedAllTimeDuration, 
        timestamp: new Date().toISOString() 
      });
      
      return durationData;
    } catch (error) {
      logger.error('❌ [CALL-DURATION] Error adding call duration:', error);
      throw error;
    }
  }

  /**
   * Broadcast duration update via Redis pub/sub
   */
  async broadcastDurationUpdate(durationData: CallDurationData): Promise<void> {
    try {
      await redisService.publish(CALL_DURATION_CHANNEL, durationData);
    } catch (error) {
      logger.error('❌ [CALL-DURATION] Error broadcasting duration update:', error);
    }
  }

  /**
   * Broadcast all-time duration update via Redis pub/sub
   */
  private async broadcastAllTimeDurationUpdate(durationData: AllTimeCallDurationData): Promise<void> {
    try {
      await redisService.publish(ALL_TIME_CALL_DURATION_CHANNEL, durationData);
    } catch (error) {
      logger.error('❌ [CALL-DURATION] Error broadcasting all-time duration update:', error);
    }
  }

  /**
   * Subscribe to call duration updates
   */
  async subscribeToDurationUpdates(callback: (data: CallDurationData) => void): Promise<void> {
    try {
      await redisService.subscribe(CALL_DURATION_CHANNEL, callback);
    } catch (error) {
      logger.error('❌ [CALL-DURATION] Error subscribing to duration updates:', error);
      throw error;
    }
  }

  /**
   * Subscribe to all-time call duration updates
   */
  async subscribeToAllTimeDurationUpdates(callback: (data: AllTimeCallDurationData) => void): Promise<void> {
    try {
      await redisService.subscribe(ALL_TIME_CALL_DURATION_CHANNEL, callback);
    } catch (error) {
      logger.error('❌ [CALL-DURATION] Error subscribing to all-time duration updates:', error);
      throw error;
    }
  }

  /**
   * Sync Redis call duration with actual database duration
   * This should be called periodically (e.g., every hour) to reconcile any discrepancies
   * Always syncs regardless of whether values match (mandatory sync)
   */
  async syncDurationWithDatabase(): Promise<void> {
    try {
      const redis = redisService.getClient();
      const currentDate = getCurrentISTDate();
      const todayKey = this.getTodayDurationKey();

      // Get actual duration from database
      const dbTodayDuration = await this.analyticsRepository.getCallDurationToday();

      logger.info(`🔄 [CALL-DURATION] Mandatory sync - DB duration: ${dbTodayDuration}`);

      // Always update Redis with DB value (mandatory sync)
      await redis.set(todayKey, dbTodayDuration.toString(), 'EX', CALL_DURATION_EXPIRATION_SECONDS);
      await this.broadcastDurationUpdate({
        duration: dbTodayDuration,
        date: currentDate,
        timestamp: new Date().toISOString()
      });
      logger.info(`✅ [CALL-DURATION] Mandatory sync completed. Today: ${dbTodayDuration}`);
    } catch (error) {
      logger.error('❌ [CALL-DURATION] Error syncing with database:', error);
      throw error;
    }
  }

  /**
   * Sync Redis all-time call duration with actual database duration
   * This should be called periodically (e.g., every 48 hours) to reconcile any discrepancies
   * Always syncs regardless of whether values match (mandatory sync)
   */
  async syncAllTimeDurationWithDatabase(): Promise<void> {
    try {
      const redis = redisService.getClient();

      // Get actual duration from database
      const dbAllTimeDuration = await this.analyticsRepository.getAllTimeCallDuration();

      logger.info(`🔄 [CALL-DURATION] Mandatory all-time sync - DB duration: ${dbAllTimeDuration}`);

      // Always update Redis with DB value (mandatory sync)
      await redis.set(ALL_TIME_CALL_DURATION_KEY, dbAllTimeDuration.toString());
      await this.broadcastAllTimeDurationUpdate({
        duration: dbAllTimeDuration,
        timestamp: new Date().toISOString()
      });
      logger.info(`✅ [CALL-DURATION] Mandatory all-time sync completed. All-time: ${dbAllTimeDuration}`);
    } catch (error) {
      logger.error('❌ [CALL-DURATION] Error syncing all-time with database:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const callCountService = new CallCountService();
