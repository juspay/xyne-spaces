import { NotificationEvent, UserBucketEntry } from '../types';
import { notificationRedisService } from '../config/redis';
import { logger } from '@/utils/logger';

export class UserBucketService {
  private readonly BUCKET_PREFIX = 'notification:bucket:';
  private readonly BUCKET_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
  private readonly MAX_EVENTS_PER_BUCKET = 100;

  async addEventToBucket(userId: string, event: NotificationEvent): Promise<void> {
    try {
      const bucketKey = `${this.BUCKET_PREFIX}${userId}`;
      const redis = notificationRedisService.getClient();

      const existingData = await redis.get(bucketKey);
      let bucket: UserBucketEntry;

      if (existingData) {
        bucket = JSON.parse(existingData);
        bucket.events.push(event);
        bucket.lastUpdated = new Date();

        if (bucket.events.length > this.MAX_EVENTS_PER_BUCKET) {
          bucket.events = bucket.events.slice(-this.MAX_EVENTS_PER_BUCKET);
        }
      } else {
        bucket = {
          userId,
          events: [event],
          lastUpdated: new Date()
        };
      }

      await redis.setex(bucketKey, this.BUCKET_TTL, JSON.stringify(bucket));
      
      logger.info(`Added event ${event.id} to bucket for offline user ${userId}`);
    } catch (error) {
      logger.error(`Failed to add event to bucket for user ${userId}:`, error);
      throw error;
    }
  }

  async getUserBucket(userId: string): Promise<NotificationEvent[]> {
    try {
      const bucketKey = `${this.BUCKET_PREFIX}${userId}`;
      const redis = notificationRedisService.getClient();

      const data = await redis.get(bucketKey);
      if (!data) {
        return [];
      }

      const bucket: UserBucketEntry = JSON.parse(data);
      return bucket.events;
    } catch (error) {
      logger.error(`Failed to get bucket for user ${userId}:`, error);
      return [];
    }
  }

  async clearUserBucket(userId: string): Promise<void> {
    try {
      const bucketKey = `${this.BUCKET_PREFIX}${userId}`;
      const redis = notificationRedisService.getClient();

      await redis.del(bucketKey);
      logger.info(`Cleared bucket for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to clear bucket for user ${userId}:`, error);
      throw error;
    }
  }

  async updateUserBucket(userId: string, events: NotificationEvent[]): Promise<void> {
    try {
      const bucketKey = `${this.BUCKET_PREFIX}${userId}`;
      const redis = notificationRedisService.getClient();

      const bucket: UserBucketEntry = {
        userId,
        events,
        lastUpdated: new Date()
      };

      await redis.setex(bucketKey, this.BUCKET_TTL, JSON.stringify(bucket));
      
      logger.info(`Updated bucket for user ${userId} with ${events.length} events`);
    } catch (error) {
      logger.error(`Failed to update bucket for user ${userId}:`, error);
      throw error;
    }
  }

  async processUserBucket(userId: string, deliveryCallback: (event: NotificationEvent) => Promise<void>): Promise<void> {
    try {
      const events = await this.getUserBucket(userId);
      
      if (events.length === 0) {
        return;
      }

      logger.info(`Processing ${events.length} events from bucket for user ${userId}`);

      for (const event of events) {
        try {
          await deliveryCallback(event);
        } catch (error) {
          logger.error(`Failed to process event ${event.id} from bucket:`, error);
        }
      }

      await this.clearUserBucket(userId);
    } catch (error) {
      logger.error(`Failed to process bucket for user ${userId}:`, error);
      throw error;
    }
  }
}