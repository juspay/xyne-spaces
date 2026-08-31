import { logger } from '@/utils/logger';
import { db, readReplicaDb } from '@/database/client';
import { stageEtaDeadlineQueue } from '@/queues/stageEtaDeadlineQueue';
import { OPEN_STATUSES } from '@/utils/etaNotificationUtils';
import { Prisma } from '@prisma/client';

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
      const batchIds = overdueTicketIds.slice(i, i + BATCH_SIZE);
      await db.$executeRaw`
        UPDATE "tickets"
        SET "isStageOverdue" = true
        WHERE "id" IN (${Prisma.join(batchIds)})
          AND ("isStageOverdue" = false OR "isStageOverdue" IS NULL)
      `;
      if (i + BATCH_SIZE < overdueTicketIds.length) {
        await sleep(BATCH_SLEEP_MS);
      }
    }
  }

  private async getOverdueTicketIds(now: Date): Promise<string[]> {
    const readerDb = readReplicaDb ?? db;
    const allOverdueTicketIds: string[] = [];
    const QUERY_BATCH_SIZE = 10000;
    let cursor: string | undefined;

    while (true) {
      const overdueEntries = await readerDb.ticketStageEta.findMany({
        where: {
          stageLeftAt: null,
          stageEta: { lte: now },
          // Ensure stage exists (filters out orphaned records with deleted stages)
          // ticket is implicitly checked via the statusV2 filter (JOIN filters out missing tickets)
          stage: { id: { not: '' } },
          ticket: {
            statusV2: { in: OPEN_STATUSES },
            // Only fetch tickets not already marked as overdue
            OR: [
              { isStageOverdue: false },
              { isStageOverdue: null },
            ],
          } as any,
        },
        select: {
          id: true,
          ticketId: true,
          stage: { select: { name: true } },
          ticket: { select: { stageName: true } },
        },
        take: QUERY_BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });

      if (overdueEntries.length === 0) break;

      // Filter to only tickets still in the overdue stage (stage name matches current stage)
      // Also skip entries with missing relations (orphaned records)
      const filteredIds = (overdueEntries as any[])
        .filter(entry => entry.stage?.name && entry.ticket?.stageName && entry.stage.name === entry.ticket.stageName)
        .map(entry => entry.ticketId);

      allOverdueTicketIds.push(...filteredIds);

      if (overdueEntries.length < QUERY_BATCH_SIZE) break;

      cursor = overdueEntries[overdueEntries.length - 1].id;
    }

    return allOverdueTicketIds;
  }

  async shutdown(): Promise<void> {
    await stageEtaDeadlineQueue.close();
    this.isInitialized = false;
    logger.info('[STAGE-ETA-DEADLINE-WORKER] Shut down');
  }
}

export const stageEtaDeadlineWorker = new StageEtaDeadlineWorker();
