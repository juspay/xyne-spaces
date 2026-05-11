import Bull from 'bull';
import {
  NotificationJobData,
  MobilePushJobData
} from '../types';
import { MobilePushChannel } from '../channels/mobilePush';

import { logger } from '@/utils/logger';
import {
  getNotificationJobCreated,
  getNotificationJobsWaiting,
  getNotificationJobStatus,
  getNotificationJobDuration,
  getNotificationJobQueueTime,
  getCallJobs
} from '@/services/otel';
import { repositories } from '@/database/repositories';
import { NotificationStatus } from '@prisma/client';

// Utility function
function getMessageTypeFromEvent(eventType: string | undefined): 'dm' | 'channel' {
  return (eventType === 'direct_message' || eventType === 'DIRECT_MESSAGE') ? 'dm' : 'channel';
}

export class NotificationWorker {
  private queue: Bull.Queue<NotificationJobData>;
  private dlq: Bull.Queue<NotificationJobData>;
  private incomingCallQueue: Bull.Queue<NotificationJobData>;
  private incomingCallDlq: Bull.Queue<NotificationJobData>;
  private mobilePushChannel: MobilePushChannel;
  private logger = logger.child({ module: 'NotificationWorker' });


  constructor() {
    // Use the same Redis configuration as redisService
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
      ...(process.env.REDIS_TLS === 'true' && {
        tls: {
          rejectUnauthorized: false
        }
      })
    };

    // Rename queue to explicitly reflect its purpose
    this.queue = new Bull('notification-queue', { redis: redisConfig });
    this.dlq = new Bull('notification-dlq', { redis: redisConfig });

    // Separate queue for high-priority incoming calls
    this.incomingCallQueue = new Bull('call-push-queue', { redis: redisConfig });
    this.incomingCallDlq = new Bull('call-push-dlq', { redis: redisConfig });

    this.mobilePushChannel = new MobilePushChannel();
  }

  private isInitialized = false;

  // Explicitly start the worker consumers
  // This should ONLY be called from the dedicated worker process
  async startWorker(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('Notification worker consumers already started');
      return;
    }

    this.logger.info('Starting Notification Worker consumers...');
    this.setupPushWorkers();
    
    this.isInitialized = true;
    this.logger.info('Notification Worker consumers started successfully');
  }

  private setupPushWorkers(): void {
    // Mobile push queue processor  
    this.queue.process('mobile_push', 10, async (job) => {
      return this.processMobilePushJob(job);
    });

    // Incoming call queue processor (High Priority)
    this.incomingCallQueue.process('incoming_call', 20, async (job) => {
      return this.processMobilePushJob(job);
    });

    this.bindQueueListeners(this.queue, this.dlq, 'mobile_push');
    this.bindQueueListeners(this.incomingCallQueue, this.incomingCallDlq, 'incoming_call');

    this.logger.info('Push notification workers initialized');
  }

  private async updateMobilePushStatus(
    notificationId: string, 
    status: NotificationStatus
  ): Promise<void> {
    try {  
      await repositories.notifications.updateStatus(
        notificationId,
        status
      );
      
      this.logger.info(`Updated notification mobile push status to ${status}`, { notificationId });
    } catch (error) {
      this.logger.error('Failed to update notification status', { notificationId, error });
    }
  }

  // Refactored processor logic to be shared
  private async processMobilePushJob(job: Bull.Job<NotificationJobData>) {
      const data = job.data as MobilePushJobData;
      const notificationId = data.payload?.notificationId;

      this.logger.info(`Processing ${job.queue.name} job`, { 
        jobId: job.id, 
        userId: data.userId,
        sessionId: data.sessionId,
        notificationId,
        notificationType: data.payload?.type,
        appVersion: data.appVersion,
      });

      const result = await this.mobilePushChannel.deliver(data);

      if (!result.success) {
        // Track failure in DB
        if (notificationId) {
          await this.updateMobilePushStatus(notificationId, NotificationStatus.FAILED);
        }

        this.logger.error(`${job.queue.name} job failed`, { 
          jobId: job.id, 
          error: result.error,
          errorCode: result.errorCode,
          retryable: result.isRetryable,
          userId: data.userId,
          notificationId,
          appVersion: data.appVersion,
        });

        // Throw error to trigger Bull retry if it's a retryable error
        if (result.isRetryable) {
          throw new Error(result.error || 'Mobile push delivery failed (Retryable)');
        }
      } else {
        // Track success in DB
        if (notificationId) {
          await this.updateMobilePushStatus(notificationId, NotificationStatus.DELIVERED);
        }
        
        this.logger.info(`${job.queue.name} job successful`, {
          jobId: job.id,
          userId: data.userId,
          notificationId,
          appVersion: data.appVersion,
        });
      }

      return result;
  }
  private bindQueueListeners(queue: Bull.Queue, dlq: Bull.Queue, jobName: string) : void {
    queue.on('completed', (job) => {
      const data = job.data as MobilePushJobData;
      const notificationId = data.payload?.notificationId || '';
      const userId = data.userId;

      if (jobName === 'incoming_call') {
        getCallJobs().add(1, { platform: data.platform, status: 'completed' });
      }

      this.logger.info(`${jobName} job completed`, { 
        jobId: job.id, 
        notificationId,
        notificationType: data.payload?.type,
        userId,
        platform: data.platform,
        appVersion: data.appVersion,
      });

      const platform = 'mobile';
      const messageType = getMessageTypeFromEvent(data.payload?.type);
      getNotificationJobsWaiting().add(-1, { platform, message_type: messageType });

      if (job.processedOn && job.finishedOn && job.timestamp) {
        const duration = job.finishedOn - job.processedOn;
        const queueTime = job.processedOn - job.timestamp;

        getNotificationJobDuration().record(duration, { platform, message_type: messageType, status: 'success' });
        getNotificationJobQueueTime().record(queueTime, { platform, message_type: messageType });
      }

      getNotificationJobStatus().add(1, {
        status: 'success',
        platform,
        message_type: messageType,
        error_type: ''
      });
    });

    queue.on('failed', async (job, err) => {
      const data = job.data as MobilePushJobData;
      const notificationId = data.payload?.notificationId || '';
      const userId = data.userId;

       if (jobName === 'incoming_call') {
        getCallJobs().add(1, { platform: data.platform, status: 'failed' });
      }

      this.logger.error(`${jobName} job failed`, { 
        jobId: job.id, 
        error: err.message,
        notificationId,
        notificationType: data.payload?.type,
        userId,
        platform: data.platform,
        appVersion: data.appVersion,
      });

      const platform = 'mobile';
      const messageType = getMessageTypeFromEvent(data.payload?.type);
      getNotificationJobsWaiting().add(-1, { platform, message_type: messageType });

      if (job.processedOn && job.finishedOn && job.timestamp) {
        const duration = job.finishedOn - job.processedOn;
        const queueTime = job.processedOn - job.timestamp;

        getNotificationJobDuration().record(duration, { platform, message_type: messageType, status: 'failed' });
        getNotificationJobQueueTime().record(queueTime, { platform, message_type: messageType });
      }

      getNotificationJobStatus().add(1, {
        status: 'failed',
        platform,
        message_type: messageType,
        error_type: err.name || 'UnknownError'
      });

      if (job.attemptsMade >= 3) {
        // Move to DLQ
        await this.moveToDLQ(dlq, job.data, jobName);
        await job.remove();
        this.logger.info(`Removed failed ${jobName} job from main queue (moved to DLQ)`, { 
          jobId: job.id,
          notificationId
        });
      }
    });

    queue.on('stalled', (job) => {
      const data = job.data as MobilePushJobData;
      this.logger.warn(`${jobName} job stalled`, {
        jobId: job.id,
        notificationId: data.payload?.notificationId,
        notificationType: data.payload?.type,
        userId: data.userId,
        platform: data.platform,
        appVersion: data.appVersion,
      });
    });

    queue.on('error', (error) => {
      this.logger.error(`${jobName} queue error`, { error });
    });

    queue.on('active', (job) => {
      const data = job.data as MobilePushJobData;
      const notificationId = data.payload?.notificationId || '';

      this.logger.info(`${jobName} job active`, { 
        jobId: job.id, 
        jobName: job.name,
        attempt: job.attemptsMade + 1,
        notificationId,
        notificationType: data.payload?.type,
        userId: data.userId,
        platform: data.platform,
        appVersion: data.appVersion,
      });
    });
  }

  private async moveToDLQ(dlq: Bull.Queue, jobData: NotificationJobData, origin: string): Promise<void> {
    try {
      await dlq.add(`failed-${origin}`, jobData, {
        removeOnComplete: false,
        removeOnFail: true
      });

      this.logger.info(`Moved ${origin} to DLQ`);
    } catch (error) {
      this.logger.error(`Failed to move ${origin} to DLQ:`, error);
    }
  }



  async addMobilePushJob(data: MobilePushJobData): Promise<void> {
    try {
      const job = await this.queue.add('mobile_push', data, {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 2000 // 2 seconds delay for first retry
        },
        removeOnComplete: true,
        removeOnFail: true
      });

      this.logger.info('Queued mobile push', {
        jobId: job.id,
        sessionId: data.sessionId,
        userId: data.userId,
        notificationId: data.payload?.notificationId,
        notificationType: data.payload?.type
      });

      const platform = 'mobile';
      const messageType = getMessageTypeFromEvent(data.payload?.type);
      getNotificationJobCreated().add(1, { platform, message_type: messageType });
      getNotificationJobsWaiting().add(1, { platform, message_type: messageType });
    } catch (error) {
      this.logger.error('Failed to queue mobile push', {
        error,
        userId: data.userId,
        notificationId: data.payload?.notificationId,
        notificationType: data.payload?.type
      });
      // Don't throw - just log the error
    }
  }

  async addIncomingCallJob(data: MobilePushJobData): Promise<void> {
    try {
      // High priority job options
      const job = await this.incomingCallQueue.add('incoming_call', data, {
        attempts: 3, // Slightly more aggressive retries for calls? Or maybe less is better if it's real-time?
        // Actually, for calls, if it fails, it's probably too late. But let's keep retries for transient flakes.
        backoff: {
          type: 'fixed', // Fixed delay might be better for calls than exponential to retry faster?
          delay: 1000 
        },
        priority: 1, // Bull supports priority (1 is highest)
        removeOnComplete: true,
        removeOnFail: true
      });

      this.logger.info('Queued incoming call push', {
        jobId: job.id,
        sessionId: data.sessionId,
        userId: data.userId,
        notificationId: data.payload?.notificationId,
      });
      // Metrics for call job created (with platform)
      getCallJobs().add(1, { platform: data.platform, status: 'created' });
      // Metrics ...
    } catch (error) {
      this.logger.error('Failed to queue incoming call push', { error });
    }
  }


  async getQueueStats(): Promise<any> {
    try {
      const waiting = await this.queue.getWaitingCount();
      const active = await this.queue.getActiveCount();
      const dlqWaiting = await this.dlq.getWaitingCount();
      
      const callWaiting = await this.incomingCallQueue.getWaitingCount();
      const callActive = await this.incomingCallQueue.getActiveCount();

      return {
        mobile_push: {
          waiting,
          active,
          dlq: dlqWaiting
        },
        incoming_call: {
          waiting: callWaiting,
          active: callActive
        }
      };
    } catch (error) {
      this.logger.error('Failed to get queue stats:', error);
      return null;
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.queue.close();
      await this.dlq.close();
      await this.incomingCallQueue.close();
      await this.incomingCallDlq.close();
      this.logger.info('Notification worker shutdown completed');
    } catch (error) {
      this.logger.error('Error during notification worker shutdown:', error);
    }
  }
}

export const notificationWorker = new NotificationWorker();
