import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { TicketsSideEffectHandler } from '@/zero/side-effects/tables/tickets-handler';
import {
  getUsersToNotifyForTicket,
  getTicketBotActorId,
  calculateDaysOverdueMidnight,
  createEtaSystemMessage,
  OPEN_STATUSES
} from '@/utils/etaNotificationUtils';
import { db } from '@/database/client';

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
      this.queue = new Bull<EtaDeadlineJobData>('eta-deadline-check', {
        redis: redisService.getRedisConfig(),
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
      // Get all non-terminal tickets with eta
      const tickets = await this.getOpenTickets();

      logger.info(`[ETA-DEADLINE] Found ${tickets.length} open tickets with ETA`);

      const actorId = await getTicketBotActorId();

      for (const ticket of tickets) {
        if (!ticket.eta) continue;

        const daysOverdue = calculateDaysOverdueMidnight(new Date(ticket.eta), today);

        if (daysOverdue > 0) {
          // Check if today is a reminder day in the exponential sequence
          if (BREACH_REMIND_DAYS.includes(daysOverdue)) {
            // Get users to notify (including form field users)
            const usersToNotify = await getUsersToNotifyForTicket(
              ticket.id,
              ticket.assignedTo,
              ticket.createdBy
            );

            // Use helper to create activities
            await TicketsSideEffectHandler.createEtaBreachActivities({
              ticketId: ticket.id,
              xyneId: ticket.xyneId,
              channelId: ticket.channelId,
              userIds: usersToNotify,
              actorAction: 'eta_breach',
              actorId,
              daysOverdue,
            });

            if (ticket.conversationId) {
              await createEtaSystemMessage({
                conversationId: ticket.conversationId,
                content: `Ticket ${ticket.xyneId} is overdue (${daysOverdue} days)`,
                createdAt: now,
                activityType: 'ETA',
              });
            }

            logger.info(
              `[ETA-DEADLINE] Sending breach reminder for ticket ${ticket.xyneId} (${daysOverdue} days overdue)`
            );
          }
        }
      }

      logger.info('[ETA-DEADLINE] ETA deadline check completed');
    } catch (error) {
      logger.error('[ETA-DEADLINE] Error checking ETA deadlines:', error);
      throw error;
    }
  }

  /**
   * Get open tickets with ETA set for overall ETA deadline checking
   */
  private async getOpenTickets(): Promise<Array<{
    id: string;
    xyneId: string;
    eta: Date | null;
    assignedTo: string | null;
    createdBy: string | null;
    channelId: string;
    conversationId: string | null;
  }>> {
    return await db.ticket.findMany({
      where: {
        eta: { not: null },
        statusV2: { in: OPEN_STATUSES },
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
