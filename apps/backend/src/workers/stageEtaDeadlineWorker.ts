import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { stageEtaDeadlineQueue } from '@/queues/stageEtaDeadlineQueue';
import {
  TicketWithStageInfo,
  OPEN_STATUSES,
} from '@/utils/etaNotificationUtils';

const BATCH_SIZE = parseInt(process.env.STAGE_ETA_DEADLINE_BATCH_SIZE || '15', 10);
const BATCH_SLEEP_MS = parseInt(process.env.STAGE_ETA_DEADLINE_BATCH_SLEEP_MS || '1000', 10);

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

class StageEtaDeadlineWorker {
  private isInitialized = false;
  private isProcessing = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await stageEtaDeadlineQueue.initialize();

    const queue = stageEtaDeadlineQueue.getQueue();

    queue.process('check-stage-eta-deadlines', async () => {
      if (this.isProcessing) {
        logger.warn(
          '[STAGE-ETA-DEADLINE-WORKER] Skipping job: previous job still in progress',
        );
        return;
      }
      return this.processJob();
    });

    queue.on('failed', (job, err) => {
      logger.error(
        `[STAGE-ETA-DEADLINE-WORKER] Job ${job.id} failed:`,
        err,
      );
    });

    this.isInitialized = true;
    logger.info('[STAGE-ETA-DEADLINE-WORKER] Started, ready to process jobs');
  }

  private async processJob(): Promise<void> {
    this.isProcessing = true;
    try {
      logger.info(
        '[STAGE-ETA-DEADLINE-WORKER] Processing stage ETA deadline check job',
      );
      await this.checkAndNotifyStageEtaDeadlines();
      logger.info('[STAGE-ETA-DEADLINE-WORKER] Stage ETA deadline check completed');
    } finally {
      this.isProcessing = false;
    }
  }

  private async checkAndNotifyStageEtaDeadlines(): Promise<void> {
    const now = new Date();

    try {
      const tickets = await this.getOpenTickets();
      await this.syncStageOverdueFlags(tickets, now);

      // Notification delivery is intentionally disabled here. This worker still runs
      // to keep tickets.isStageOverdue in sync for sidebar/filter/count usage.
      // const ticketsEligibleForNotifications = this.filterTicketsEligibleForNotifications(tickets, now);
      // if (ticketsEligibleForNotifications.length === 0) return;
      // await this.checkAndNotifyForStageEta(ticketsEligibleForNotifications, now);

    } catch (error) {
      logger.error('[STAGE-ETA-DEADLINE-WORKER] Error checking stage ETA deadlines:', error);
      throw error;
    }
  }

  private async getOpenTickets(): Promise<TicketWithStageInfo[]> {
    return await db.ticket.findMany({
      where: {
        statusV2: { in: OPEN_STATUSES },
      },
      select: {
        id: true,
        xyneId: true,
        assignedTo: true,
        createdBy: true,
        channelId: true,
        conversationId: true,
        stageName: true,
        eta: true,
        workspaceId: true,
      },
    });
  }

  // private filterTicketsEligibleForNotifications(
  //   tickets: TicketWithStageInfo[],
  //   now: Date,
  // ): TicketWithStageInfo[] {
  //   const todayMidnight = new Date(now);
  //   todayMidnight.setHours(0, 0, 0, 0);

  //   return tickets.filter(ticket => !ticket.eta || ticket.eta >= todayMidnight);
  // }

  private async syncStageOverdueFlags(
    tickets: TicketWithStageInfo[],
    now: Date,
  ): Promise<void> {
    if (tickets.length === 0) {
      await db.ticket.updateMany({
        where: {
          OR: [
            { statusV2: { notIn: OPEN_STATUSES } },
            { isArchived: true },
          ],
          isStageOverdue: true,
        } as any,
        data: { isStageOverdue: false } as any,
      });
      return;
    }

    const ticketById = new Map(tickets.map(ticket => [ticket.id, ticket]));

    const overdueStageEntries = await db.ticketStageEta.findMany({
      where: {
        ticketId: { in: tickets.map(ticket => ticket.id) },
        stageLeftAt: null,
        stageEta: { lte: now },
        stage: {
          eta: { gt: 0 },
        },
      },
      select: {
        ticketId: true,
        stage: {
          select: { name: true },
        },
      },
    });

    const overdueTicketIds = new Set(
      overdueStageEntries
        .filter(entry => entry.stage.name === ticketById.get(entry.ticketId)?.stageName)
        .map(entry => entry.ticketId)
    );
    const openTicketIds = tickets.map(ticket => ticket.id);
    const notOverdueTicketIds = openTicketIds.filter(ticketId => !overdueTicketIds.has(ticketId));

    if (overdueTicketIds.size > 0) {
      const overdueIds = [...overdueTicketIds];
      for (let i = 0; i < overdueIds.length; i += BATCH_SIZE) {
        await db.ticket.updateMany({
          where: {
            id: { in: overdueIds.slice(i, i + BATCH_SIZE) },
            isStageOverdue: false,
          } as any,
          data: { isStageOverdue: true } as any,
        });
        if (i + BATCH_SIZE < overdueIds.length) {
          await sleep(BATCH_SLEEP_MS);
        }
      }
    }

    if (notOverdueTicketIds.length > 0) {
      for (let i = 0; i < notOverdueTicketIds.length; i += BATCH_SIZE) {
        await db.ticket.updateMany({
          where: {
            id: { in: notOverdueTicketIds.slice(i, i + BATCH_SIZE) },
            isStageOverdue: true,
          } as any,
          data: { isStageOverdue: false } as any,
        });
        if (i + BATCH_SIZE < notOverdueTicketIds.length) {
          await sleep(BATCH_SLEEP_MS);
        }
      }
    }

    await db.ticket.updateMany({
      where: {
        OR: [
          { statusV2: { notIn: OPEN_STATUSES } },
          { isArchived: true },
        ],
        isStageOverdue: true,
      } as any,
      data: { isStageOverdue: false } as any,
    });
  }
  async shutdown(): Promise<void> {
    await stageEtaDeadlineQueue.close();
    this.isInitialized = false;
    logger.info('[STAGE-ETA-DEADLINE-WORKER] Shut down');
  }
}

export const stageEtaDeadlineWorker = new StageEtaDeadlineWorker();
