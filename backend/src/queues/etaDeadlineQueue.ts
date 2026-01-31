import Bull from 'bull';
import { ActivityClassification, Prisma, TicketStatus } from '@prisma/client';
import { MessageType } from '@xyne/shared';
import { randomUUID } from 'crypto';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

// Job Types
export type EtaDeadlineJobType = 'check-eta-deadlines';

export interface EtaDeadlineJobData {
  type: EtaDeadlineJobType;
}

// Cron pattern: '0 0 * * *' = midnight every day
const MIDNIGHT_CRON = '0 0 * * *';

class EtaDeadlineQueue {
  private queue: Bull.Queue<EtaDeadlineJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    this.isInitializing = true;

    try {
      const redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        maxRetriesPerRequest: 3,
        ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
        ...(process.env.REDIS_TLS === 'true' && {
          tls: {
            rejectUnauthorized: false
          }
        })
      };

      this.queue = new Bull<EtaDeadlineJobData>('eta-deadline-check', {
        redis: redisConfig,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      });

      this.setupProcessor();
      this.setupEventListeners();

      // Schedule the repeatable job to run at midnight every day
      await this.scheduleRepeatableJob();

      this.isInitialized = true;
      logger.info('[ETA-DEADLINE] Queue initialized successfully');
    } catch (error) {
      logger.error('[ETA-DEADLINE] Failed to initialize queue:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private async scheduleRepeatableJob(): Promise<void> {
    if (!this.queue) return;

    await this.queue.add(
      'check-eta-deadlines',
      { type: 'check-eta-deadlines' },
      {
        repeat: { cron: MIDNIGHT_CRON },
        jobId: 'eta-deadline-check-repeatable',
      }
    );
    logger.info('[ETA-DEADLINE] Scheduled repeatable job: check-eta-deadlines (midnight daily)');
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    this.queue.process('check-eta-deadlines', async () => {
      logger.info('[ETA-DEADLINE] Processing ETA deadline check job');
      await this.checkAndNotifyEtaDeadlines();
      logger.info('[ETA-DEADLINE] ETA deadline check completed');
    });
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, error) => {
      logger.error(`[ETA-DEADLINE] Job ${job.name} failed:`, error);
    });

    this.queue.on('error', (error) => {
      logger.error('[ETA-DEADLINE] Queue error:', error);
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`[ETA-DEADLINE] Job ${job.name} stalled`);
    });
  }

  private async checkAndNotifyEtaDeadlines(): Promise<void> {
    const now = new Date();

    // Calculate date boundaries in UTC
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const BREACH_REMIND_DAYS = [1, 3, 7, 15, 31, 63, 127, 255];

    try {
      // Get all open tickets with eta
      const openStatuses = [
        TicketStatus.NEW,
        TicketStatus.IN_PROGRESS,
        TicketStatus.WAIT_FOR_APPROVAL,
      ];
      const tickets = await db.ticket.findMany({
        where: {
          eta: { not: null },
          status: { in: openStatuses },
        },
        select: {
          id: true,
          xyneId: true,
          eta: true,
          assignedTo: true,
          createdBy: true,
          channelId: true,
          conversationId: true,
        },
      });

      logger.info(`[ETA-DEADLINE] Found ${tickets.length} open tickets with ETA`);

      const activitiesToCreate: Prisma.ActivityCreateManyInput[] = [];

      for (const ticket of tickets) {
        if (!ticket.eta) continue;

        const etaDate = new Date(ticket.eta);
        const etaMidnight = new Date(etaDate);
        etaMidnight.setHours(0, 0, 0, 0);


        const daysOverdue = Math.floor(
          (today.getTime() - etaMidnight.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Check if ETA is today (warning)
        if (daysOverdue === 0) {
          // Create activities for both assignedTo and createdBy
          const usersToNotify = [...new Set([
            ticket.assignedTo,
            ticket.createdBy,
          ].filter((userId): userId is string => typeof userId === 'string' && userId.length > 0))];

          for (const userId of usersToNotify) {
            activitiesToCreate.push({
              userId,
              actorAction: 'eta_warning',
              actionSource: 'ticket',
              actionSourceId: ticket.id,
              channelId: ticket.channelId,
              classification: ActivityClassification.ACTIONABLE,
              isRead: false,
              createdAt: now,
            });
          }

          if (ticket.conversationId) {
            await this.createEtaMessage(ticket.conversationId, `Ticket ${ticket.xyneId} is due today`, now);
          }

          logger.info(`[ETA-DEADLINE] Sending warning for ticket ${ticket.xyneId} (ETA: ${ticket.eta})`);
        }


        if (daysOverdue > 0) {
          // Check if today is a reminder day in the exponential sequence
          if (BREACH_REMIND_DAYS.includes(daysOverdue)) {
            const usersToNotify = [...new Set([
              ticket.assignedTo,
              ticket.createdBy,
            ].filter((userId): userId is string => typeof userId === 'string' && userId.length > 0))];

            for (const userId of usersToNotify) {
              activitiesToCreate.push({
                userId,
                actorAction: 'eta_breach',
                actionSource: 'ticket',
                actionSourceId: ticket.id,
                channelId: ticket.channelId,
                classification: ActivityClassification.ACTIONABLE,
                isRead: false,
                createdAt: now,
              });
            }

            if (ticket.conversationId) {
              await this.createEtaMessage(ticket.conversationId, `Ticket ${ticket.xyneId} is overdue (${daysOverdue} days)`, now);
            }

            logger.info(
              `[ETA-DEADLINE] Sending breach reminder for ticket ${ticket.xyneId} (${daysOverdue} days overdue)`
            );
          }
        }
      }

      // Batch create activities
      if (activitiesToCreate.length > 0) {
        await db.activity.createMany({
          data: activitiesToCreate,
        });
        logger.info(`[ETA-DEADLINE] Created ${activitiesToCreate.length} activities`);
      } else {
        logger.info('[ETA-DEADLINE] No ETA notifications to send');
      }
    } catch (error) {
      logger.error('[ETA-DEADLINE] Error checking ETA deadlines:', error);
      throw error;
    }
  }

  private async createEtaMessage(conversationId: string, content: string, createdAt: Date): Promise<void> {
    await db.message.create({
      data: {
        messageId: randomUUID(),
        conversationId,
        senderId: 'system',
        content,
        msgType: MessageType.SYSTEM,
        hasAttachment: false,
        edited: false,
        isDeleted: false,
        isSent: true,
        showInChannel: false,
        createdAt,
        metadata: {
          activityType: 'ETA',
          isTicketActivity: true,
        },
      },
    });
  }

  /**
   * Gracefully close the queue
   */
  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[ETA-DEADLINE] Queue closed');
    }
  }
}

// Export singleton instance
export const etaDeadlineQueue = new EtaDeadlineQueue();
