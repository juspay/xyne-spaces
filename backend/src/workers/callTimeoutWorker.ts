import Bull from 'bull';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { notificationService } from '@/services/notificationService';
import { InvitationResponse } from '@prisma/client';
import { NotificationType } from '@prisma/client';

const CALL_TIMEOUT_QUEUE_NAME = 'call-timeout-queue';

export class CallTimeoutWorker {
  private queue: Bull.Queue;
  private logger = logger.child({ module: 'CallTimeoutWorker' });

  constructor() {
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

    this.queue = new Bull(CALL_TIMEOUT_QUEUE_NAME, {
      redis: redisConfig,
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
      }
    });
  }

  // Producer Methods
  async addJob(participantId: string, data: { callId: string; participantId: string; invitedByUserId: string; invitedAt: number }) {
    // 32 seconds timeout
    const delay = 32 * 1000;
    const jobId = `call_timeout_${participantId}`;
    
    await this.queue.add(data, {
      delay,
      jobId, // Unique ID to allow removal
      removeOnComplete: false,
      removeOnFail: false
    });
    this.logger.info(`Added call timeout job for participant ${participantId} with delay ${delay}ms`);
  }

  async removeJob(participantId: string) {
    const jobId = `call_timeout_${participantId}`;
    try {
      const job = await this.queue.getJob(jobId);
      
      if (job) {
        // If job is waiting or delayed, remove it
        await job.remove();
        this.logger.info(`Removed call timeout job for participant ${participantId}`);
      }
    } catch (error) {
       this.logger.error(`Failed to remove job ${jobId}: ${error}`);
    }
  }

  // Consumer Method (to be called in worker process)
  async startWorker() {
    this.logger.info('Starting Call Timeout Worker...');
    
    this.queue.process(async (job) => {
      await this.processJob(job);
    });

    this.queue.on('completed', (job) => {
      this.logger.info(`Call timeout job ${job.id} completed`);
    });

    this.queue.on('failed', (job, err) => {
      this.logger.error(`Call timeout job ${job.id} failed: ${err.message}`);
    });
    
    this.logger.info('Call Timeout Worker started');
  }

  async shutdown() {
    await this.queue.close();
    this.logger.info('Call Timeout Worker shutdown');
  }

  private async processJob(job: Bull.Job) {
    const { callId, participantId, invitedByUserId } = job.data;
    this.logger.info(`Processing timeout for participant ${participantId} in call ${callId}`);

    try {
        // 1. Fetch Participant
        const participant = await db.callParticipant.findUnique({
            where: { id: participantId },
        });

        if (!participant) {
            this.logger.warn(`Participant ${participantId} not found, skipping timeout processing`);
            return;
        }

        // 2. Check status - only timeout if still INVITED
        if (participant.response === InvitationResponse.INVITED) {
            this.logger.info(`Participant ${participantId} timed out (still INVITED). Updating to MISSED.`);
            
            // 3. Update to MISSED
            await db.callParticipant.update({
                where: { id: participantId },
                data: {
                    response: InvitationResponse.MISSED,
                    respondedAt: new Date(),
                }
            });

            // Fetch Call and User for notifications
            const call = await db.call.findUnique({ where: { id: participant.callId } });
            const user = await db.user.findUnique({ where: { id: participant.userId } });
            
            if (!call) return; // Should not happen

            // 4. Send "User Unavailable" to Caller
            const recipientName = user?.name || 'User';
            await notificationService.createNotification(invitedByUserId, {
                title: 'Call Missed',
                message: `${recipientName} is unavailable.`,
                type: NotificationType.MISSED_CALL,
                relatedEntityType: 'call',
                relatedEntityId: call.externalId,
            });

            // 5. Send "Missed Call" to Recipient
            const caller = await db.user.findUnique({ where: { id: invitedByUserId } });
            const callerName = caller?.name || 'Someone';
            
            await notificationService.createNotification(participant.userId, {
                title: 'Missed Call',
                message: `You missed a call from ${callerName}`,
                type: NotificationType.MISSED_CALL,
                relatedEntityType: 'call',
                relatedEntityId: call.externalId,
                metadata: {
                   callId: call.externalId,
                   channelId: call.channelId,
                   callerId: invitedByUserId,
                   callerName: callerName,
                   callType: call.callType,
                   reason: 'timeout'
                }
            });


            
            this.logger.info(`Timeout processed for ${participantId}: Updated to MISSED, notified caller.`);
        } else {
            this.logger.info(`Participant ${participantId} status is ${participant.response}, skipping timeout.`);
        }

    } catch (error) {
        this.logger.error(`Error processing call timeout job ${job.id}:`, error);
        throw error;
    }
  }
}

export const callTimeoutWorker = new CallTimeoutWorker();
