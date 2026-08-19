import { NotificationEvent, MobilePushJobData, MobilePushPayload, DeliveryChannel } from '../types';
import { NotificationStatus } from '@xyne/shared';
import { notificationWorker } from '../consumers/notificationWorker';
import { notificationRedisService } from '../config/redis';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { v4 as uuidv4 } from 'uuid';
import { notificationLogService } from '../notificationLogService';

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

      // workspace context — clients always render workspace at the top.
      let workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : undefined;
      let workspaceName: string | undefined;
      let orgMemberId: string | undefined;
      try {
        let ctx = await redisService.getWorkspaceContext(userId);
        if (!ctx) {
          const user = await repositories.users.findByIdWithWorkspace(userId);
          if (user?.orgMemberId && user?.workspaceId) {
            ctx = {
              workspaceId: user.workspaceId,
              workspaceName: user.workspace?.name ?? '',
              orgMemberId: user.orgMemberId,
            };
            await redisService.setWorkspaceContext(userId, ctx);
          }
        }
        workspaceId ??= ctx?.workspaceId;
        if (workspaceId === ctx?.workspaceId) {
          workspaceName = ctx?.workspaceName;
        }
        orgMemberId = ctx?.orgMemberId;
      } catch (lookupError) {
        this.logger.error('Failed to resolve workspace context for notification', { userId, error: lookupError });
      }

      const event: NotificationEvent = {
        id: eventId,
        userId,
        type,
        title,
        message,
        actionUrl,
        data,
        createdAt: new Date(),
        ...(workspaceId && { workspaceId }),
        ...(workspaceName && { workspaceName }),
      };

      if (orgMemberId) {
        try {
          await redisService.publishOrgMemberEvent(orgMemberId, {
            type: 'notification_received',
            orgMemberId,
            data: {
              ...event,
              sourceUserId: userId,
            },
            timestamp: new Date(),
          });
        } catch (broadcastError) {
          this.logger.error('Failed org-member notification broadcast', { userId, orgMemberId, error: broadcastError });
          throw broadcastError;
        }
      } else {
        this.logger.warn('Notification realtime broadcast skipped: orgMemberId not resolved', { userId, eventId });
      }

      this.logger.info('Notification broadcasted via Redis', {
        eventId: event.id,
        userId,
        orgMemberId,
        type,
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
    // SDLCT-0002: stamp a correlation id once, at pipeline entry, so every
    // downstream event (queue -> worker -> provider) joins to this send.
    if (!payload.correlationId) {
      payload.correlationId = uuidv4();
    }
    const logCtx = {
      workspaceId: payload.workspaceId,
      correlationId: payload.correlationId,
      notificationId: payload.notificationId,
      channel: 'MOBILE_PUSH' as const,
      provider: (session.platform === 'ios' ? 'APNS' : 'FCM') as 'APNS' | 'FCM',
      metadata: {
        notificationType: payload.type,
        platform: session.platform,
        appVersion: session.appVersion,
        sessionId: session.id,
      },
    };
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

      void notificationLogService.recordDeliveryPlanned(logCtx);

      if (payload.type === 'INCOMING_CALL') {
        await notificationWorker.addIncomingCallJob(jobData);
        this.logger.info('Queued incoming call push (High Priority)', {
          userId,
        });
      } else {
        await notificationWorker.addMobilePushJob(jobData);
        this.logger.info('Queued mobile push', {
          userId,
        });
      }

      void notificationLogService.recordQueueEnqueued(logCtx);
    } catch (error) {
      this.logger.error('Failed to queue mobile push', { userId, error });
      void notificationLogService.recordDeliveryFailedFinal({ ...logCtx, reasonCode: 'ENQUEUE_FAILED' });
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
