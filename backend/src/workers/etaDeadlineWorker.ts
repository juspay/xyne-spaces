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
const ETA_REMINDER_BATCH_SIZE = 50;
const ETA_REMINDER_BATCH_DELAY_MS = 1000;

const chunkArray = <T>(items: T[], chunkSize: number): T[][] => {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) return;
  await new Promise(resolve => setTimeout(resolve, ms));
};

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
      const tickets = await this.getOpenTickets(today);

      logger.info(`[ETA-DEADLINE-WORKER] Found ${tickets.length} open tickets with ETA`);

      const ticketBatches = chunkArray(tickets, ETA_REMINDER_BATCH_SIZE);

      for (let batchIndex = 0; batchIndex < ticketBatches.length; batchIndex += 1) {
        const ticketBatch = ticketBatches[batchIndex]!;

        logger.info(
          `[ETA-DEADLINE-WORKER] Processing ETA batch ${batchIndex + 1}/${ticketBatches.length} (${ticketBatch.length} tickets)`
        );

        for (const ticket of ticketBatch) {
          if (!ticket.eta) continue;

          const actorId = await getTicketBotActorId(ticket.workspaceId);
          const daysOverdue = calculateDaysOverdueMidnight(new Date(ticket.eta), today);

          if (daysOverdue <= 0 || !BREACH_REMIND_DAYS.includes(daysOverdue)) {
            continue;
          }

          const usersToNotify = await getUsersToNotifyForTicket(
            ticket.id,
            ticket.assignedTo,
            ticket.createdBy
          );

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

        if (batchIndex < ticketBatches.length - 1) {
          await sleep(ETA_REMINDER_BATCH_DELAY_MS);
        }
      }

      logger.info('[ETA-DEADLINE-WORKER] ETA deadline check completed');
    } catch (error) {
      logger.error('[ETA-DEADLINE-WORKER] Error checking ETA deadlines:', error);
      throw error;
    }
  }

  private async getOpenTickets(today: Date): Promise<Array<{
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
        eta: {
          not: null,
          lt: today,
        },
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
