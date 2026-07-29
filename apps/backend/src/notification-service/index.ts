import { NotificationProducer } from './producers/notificationProducer';
import { NotificationWorker } from './consumers/notificationWorker';
import { logger } from '@/utils/logger';
import { MobilePushPayload } from './types';

export class NotificationService {
  private producer: NotificationProducer;
  private worker: NotificationWorker | null = null;
  private isInitialized = false;
  private logger = logger.child({ module: 'NotificationService' });

  constructor() {
    this.producer = new NotificationProducer();
  }

  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) {
        this.logger.warn('Notification service already initialized');
        return;
      }

      await this.producer.initialize();
      this.isInitialized = true;

      this.logger.info('Notification service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize notification service:', error);
      throw error;
    }
  }

  async sendNotification(
    userId: string,
    type: string,
    title: string,
    message: string,
    data?: Record<string, any>,
    actionUrl?: string
  ): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Notification service not initialized');
    }

    return await this.producer.sendNotification(userId, type, title, message, data, actionUrl);
  }

  async queueMobilePush(
    userId: string,
    session: { id: string; token: string; voipToken?: string; platform: string; appVersion?: string },
    payload: MobilePushPayload
  ): Promise<void> {
    if (!this.isInitialized) {
      this.logger.info('Notification service not initialized, skipping mobile push');
      return;
    }

    await this.producer.queueMobilePush(userId, session, payload);
  }

  async acknowledgeNotification(eventId: string, userId: string): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('Notification service not initialized');
    }

    return await this.producer.acknowledgeNotification(eventId, userId);
  }



  async getStats(): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('Notification service not initialized');
    }

    return await this.producer.getStats();
  }

  async shutdown(): Promise<void> {
    try {
      if (this.worker) {
        await this.worker.shutdown();
      }

      if (this.isInitialized) {
        await this.producer.shutdown();
      }

      this.isInitialized = false;
      this.logger.info('Notification service shutdown completed');
    } catch (error) {
      this.logger.error('Error during notification service shutdown:', error);
    }
  }
}

export const notificationService = new NotificationService();

export * from './types';
export { NotificationProducer } from './producers/notificationProducer';
export { NotificationWorker } from './consumers/notificationWorker';