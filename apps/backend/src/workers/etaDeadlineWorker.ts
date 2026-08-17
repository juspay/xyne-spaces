import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { etaDeadlineQueue } from '@/queues/etaDeadlineQueue';
import { OPEN_STATUSES } from '@/utils/etaNotificationUtils';

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
      logger.info(
        '[ETA-DEADLINE-WORKER] Notification and activity delivery are disabled; no overdue column is updated here'
      );

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
