import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { etaDeadlineQueue } from '@/queues/etaDeadlineQueue';
import { TicketsSideEffectHandler } from '@/zero/side-effects/tables/tickets-handler';
import {
  getUsersToNotifyForTicket,
  getTicketBotActorId,
  calculateDaysOverdueMidnight,
  createEtaSystemMessage,
  OPEN_STATUSES,
} from '@/utils/etaNotificationUtils';

const BREACH_REMIND_DAYS = [1, 3, 7, 15, 31, 63, 127, 255];

class EtaDeadlineWorker {
  private isInitialized = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await etaDeadlineQueue.initialize();

    const queue = etaDeadlineQueue.getQueue();

    queue.process('check-eta-deadlines', async () => {
      return this.processJob();
    });

    queue.on('failed', (job, err) => {
      logger.error(`[ETA-DEADLINE-WORKER] Job ${job.id} failed:`, err);
    });

    this.isInitialized = true;
    logger.info('[ETA-DEADLINE-WORKER] Started, ready to process jobs');
  }

  private async processJob(): Promise<void> {
    logger.info('[ETA-DEADLINE-WORKER] Processing ETA deadline check job');
    await this.checkAndNotifyEtaDeadlines();
    logger.info('[ETA-DEADLINE-WORKER] ETA deadline check completed');
  }

  private async checkAndNotifyEtaDeadlines(): Promise<void> {
    const now = new Date();

    // Calculate date boundaries in UTC
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    try {
      // Get all non-terminal tickets with eta
      const tickets = await this.getOpenTickets();

      logger.info(`[ETA-DEADLINE-WORKER] Found ${tickets.length} open tickets with ETA`);

      for (const ticket of tickets) {
        if (!ticket.eta) continue;

        // Get bot actorId for this ticket's workspace
        const actorId = await getTicketBotActorId(ticket.workspaceId);

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
              `[ETA-DEADLINE-WORKER] Sending breach reminder for ticket ${ticket.xyneId} (${daysOverdue} days overdue)`
            );
          }
        }
      }

      logger.info('[ETA-DEADLINE-WORKER] ETA deadline check completed');
    } catch (error) {
      logger.error('[ETA-DEADLINE-WORKER] Error checking ETA deadlines:', error);
      throw error;
    }
  }

  private async getOpenTickets(): Promise<Array<{
    id: string;
    xyneId: string;
    eta: Date | null;
    assignedTo: string | null;
    createdBy: string | null;
    channelId: string;
    conversationId: string | null;
    workspaceId: string;
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
        workspaceId: true,
        conversationId: true,
      },
    });
  }

  async shutdown(): Promise<void> {
    await etaDeadlineQueue.close();
    this.isInitialized = false;
    logger.info('[ETA-DEADLINE-WORKER] Shut down');
  }
}

export const etaDeadlineWorker = new EtaDeadlineWorker();
