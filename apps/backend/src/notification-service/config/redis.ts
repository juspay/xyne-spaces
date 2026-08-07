import Redis from 'ioredis';
import { logger } from '@/utils/logger';
import { createRedisClient, connectWithRetryForever } from '@/services/redisFactory';

class NotificationRedisService {
  private redis: Redis | null = null;
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;

  constructor() {
    this.initializeRedis();
  }

  private initializeRedis(): void {
    try {
      this.redis = createRedisClient('notification');
      this.publisher = createRedisClient('notification-publisher');
      this.subscriber = createRedisClient('notification-subscriber');
    } catch (error) {
      logger.error('Failed to initialize Notification Redis:', error);
    }
  }

  async connect(): Promise<void> {
    await Promise.all([
      this.redis ? connectWithRetryForever(this.redis, 'notification') : Promise.resolve(),
      this.publisher
        ? connectWithRetryForever(this.publisher, 'notification-publisher')
        : Promise.resolve(),
      this.subscriber
        ? connectWithRetryForever(this.subscriber, 'notification-subscriber')
        : Promise.resolve(),
    ]);
    logger.info('All Notification Redis connections established');
  }

  async disconnect(): Promise<void> {
    try {
      if (this.redis) await this.redis.disconnect();
      if (this.publisher) await this.publisher.disconnect();
      if (this.subscriber) await this.subscriber.disconnect();
      logger.info('All Notification Redis connections closed');
    } catch (error) {
      logger.error('Error disconnecting from Notification Redis:', error);
    }
  }

  getClient(): Redis {
    if (!this.redis) throw new Error('Notification Redis not initialized');
    return this.redis;
  }

  getPublisher(): Redis {
    if (!this.publisher) throw new Error('Notification Redis publisher not initialized');
    return this.publisher;
  }

  getSubscriber(): Redis {
    if (!this.subscriber) throw new Error('Notification Redis subscriber not initialized');
    return this.subscriber;
  }
}

export const notificationRedisService = new NotificationRedisService();