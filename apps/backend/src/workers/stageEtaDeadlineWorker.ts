import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { stageEtaDeadlineQueue } from '@/queues/stageEtaDeadlineQueue';
import { OPEN_STATUSES } from '@/utils/etaNotificationUtils';

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
      await this.syncStageOverdueFlags();
      logger.info('[STAGE-ETA-DEADLINE-WORKER] Stage ETA deadline check completed');
    } catch (error) {
      logger.error('[STAGE-ETA-DEADLINE-WORKER] Error checking stage ETA deadlines:', error);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  private async syncStageOverdueFlags(now: Date = new Date()): Promise<void> {
    const overdueTicketIds = await this.getOverdueTicketIds(now);

    if (overdueTicketIds.length === 0) return;

    for (let i = 0; i < overdueTicketIds.length; i += BATCH_SIZE) {
      await db.ticket.updateMany({
        where: {
          id: { in: overdueTicketIds.slice(i, i + BATCH_SIZE) },
          isStageOverdue: false,
        } as any,
        data: { isStageOverdue: true } as any,
      });
      if (i + BATCH_SIZE < overdueTicketIds.length) {
        await sleep(BATCH_SLEEP_MS);
      }
    }
  }

  private async getOverdueTicketIds(now: Date): Promise<string[]> {
    const overdueEntries = await db.ticketStageEta.findMany({
      where: {
        stageLeftAt: null,
        stageEta: { lte: now },
        ticket: {
          statusV2: { in: OPEN_STATUSES },
        },
      },
      select: {
        ticketId: true,
        stage: { select: { name: true } },
        ticket: { select: { stageName: true } },
      },
    });

    return overdueEntries
      .filter(entry => entry.stage.name === entry.ticket.stageName)
      .map(entry => entry.ticketId);
  }

  async shutdown(): Promise<void> {
    await stageEtaDeadlineQueue.close();
    this.isInitialized = false;
    logger.info('[STAGE-ETA-DEADLINE-WORKER] Shut down');
  }
}

export const stageEtaDeadlineWorker = new StageEtaDeadlineWorker();
