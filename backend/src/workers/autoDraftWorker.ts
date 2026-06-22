import Bull from 'bull';
import { logger } from '@/utils/logger';
import { autoDraftQueue, type AutoDraftJobData } from '@/queues/autoDraftQueue';
import { emailService } from '@/services/emailService';

class AutoDraftWorker {
  private isInitialized = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await autoDraftQueue.initialize();

    const queue = autoDraftQueue.getQueue();

    queue.process('draft', 5, async (job: Bull.Job<AutoDraftJobData>) => {
      return this.processJob(job);
    });

    queue.on('failed', (job, err) => {
      logger.error(
        `[AUTO-DRAFT-WORKER] Job ${job.id} permanently failed — ticket ${job.data.ticketId}:`,
        err,
      );
    });

    this.isInitialized = true;
    logger.info('[AUTO-DRAFT-WORKER] Started, ready to process jobs');
  }

  private async processJob(job: Bull.Job<AutoDraftJobData>): Promise<void> {
    const { ticketId } = job.data;
    logger.info(`[AUTO-DRAFT-WORKER] Processing job ${job.id} — ticket ${ticketId}`);

    const dispatched = await emailService.retriggerAutoDraftForTicket(ticketId);

    if (dispatched) {
      logger.info(`[AUTO-DRAFT-WORKER] Draft triggered for ticket ${ticketId}`);
    } else {
      logger.info(`[AUTO-DRAFT-WORKER] Draft skipped for ticket ${ticketId} — ticket/email not found`);
    }
  }

  async shutdown(): Promise<void> {
    await autoDraftQueue.close();
    this.isInitialized = false;
    logger.info('[AUTO-DRAFT-WORKER] Shut down');
  }
}

export const autoDraftWorker = new AutoDraftWorker();
