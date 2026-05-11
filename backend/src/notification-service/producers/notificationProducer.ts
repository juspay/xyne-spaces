import { NotificationEvent, MobilePushJobData, MobilePushPayload, DeliveryChannel } from '../types';
import { notificationWorker } from '../consumers/notificationWorker';
import { notificationRedisService } from '../config/redis';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { v4 as uuidv4 } from 'uuid';
import { NotificationStatus } from '@prisma/client';

export class NotificationProducer {
  private logger = logger.child({ module: 'NotificationProducer' });

  constructor() {}

  async initialize(): Promise<void> {
    try {
      await notificationRedisService.connect();
      this.logger.info('Notification producer initialized');
    } catch (error) {
      this.logger.error('Failed to initialize notification producer', { error });
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
    try {
      const eventId = uuidv4();
      const event: NotificationEvent = {
        id: eventId,
        userId,
        type,
        title,
        message,
        actionUrl,
        data,
        createdAt: new Date(),
      };

      await redisService.broadcastNotificationEvent(userId, event);

      this.logger.info('Notification broadcasted via Redis', {
        eventId: event.id,
        userId,
        type,
        title,
      });

      return event.id;
    } catch (error) {
      this.logger.error('Failed to send notification', { userId, error });
      throw error;
    }
  }

  async acknowledgeNotification(eventId: string, userId: string): Promise<boolean> {
    try {
      const notificationId = eventId;
      
      await repositories.notifications.updateStatus(
        notificationId,
        NotificationStatus.DELIVERED
      );
      
      this.logger.info('Notification acknowledged', { notificationId, userId });
      return true;
    } catch (error) {
      this.logger.error('Failed to acknowledge notification', { eventId, error });
      return false;
    }
  }

  async queueMobilePush(
    userId: string,
    session: { id: string; token: string; voipToken?: string; platform: string; appVersion?: string },
    payload: MobilePushPayload
  ): Promise<void> {
    try {
      const jobData: MobilePushJobData = {
        channel: DeliveryChannel.MOBILE_PUSH,
        userId,
        sessionId: session.id,
        token: session.token,
        voipToken: session.voipToken,
        platform: session.platform,
        appVersion: session.appVersion,
        payload,
      };

      if (payload.type === 'INCOMING_CALL') {
        await notificationWorker.addIncomingCallJob(jobData);
        this.logger.info('Queued incoming call push (High Priority)', {
          sessionId: session.id.substring(0, 8),
          userId,
        });
      } else {
        await notificationWorker.addMobilePushJob(jobData);
        this.logger.info('Queued mobile push', {
          sessionId: session.id.substring(0, 8),
          userId,
        });
      }
    } catch (error) {
      this.logger.error('Failed to queue mobile push', { userId, error });
      // Don't throw - just log
    }
  }

  async getStats(): Promise<any> {
    try {
      return await notificationWorker.getQueueStats();
    } catch (error) {
      this.logger.error('Failed to get notification stats:', error);
      return null;
    }
  }

  async shutdown(): Promise<void> {
    try {
      await notificationWorker.shutdown();
      await notificationRedisService.disconnect();
      this.logger.info('Notification producer shutdown completed');
    } catch (error) {
      this.logger.error('Error during notification producer shutdown:', error);
    }
  }
}
