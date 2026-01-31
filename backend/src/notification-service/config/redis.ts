import Redis from 'ioredis';
import { logger } from '@/utils/logger';

class NotificationRedisService {
  private redis: Redis | null = null;
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;

  constructor() {
    this.initializeRedis();
  }

  private initializeRedis(): void {
    try {
      const config = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
        ...(process.env.REDIS_TLS === 'true' && {
          tls: { rejectUnauthorized: false }
        })
      };

      this.redis = new Redis(config);
      this.publisher = new Redis(config);
      this.subscriber = new Redis(config);

      this.redis.on('connect', () => {
        logger.info('Notification Redis connected successfully');
      });

      this.redis.on('error', (error) => {
        logger.error('Notification Redis connection error:', error);
      });

    } catch (error) {
      logger.error('Failed to initialize Notification Redis:', error);
    }
  }

  async connect(): Promise<void> {
    try {
      if (this.redis) await this.redis.connect();
      if (this.publisher) await this.publisher.connect();
      if (this.subscriber) await this.subscriber.connect();
      logger.info('All Notification Redis connections established');
    } catch (error) {
      logger.error('Failed to connect to Notification Redis:', error);
    }
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