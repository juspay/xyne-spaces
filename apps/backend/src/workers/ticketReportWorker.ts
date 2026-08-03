import Bull from 'bull';
import { logger } from '@/utils/logger';
import { ticketReportService } from '@/services/ticketReportService';
import {
  ticketReportQueue,
  type TicketReportJobData,
} from '@/queues/ticketReportQueue';
import { ticketReportTempFileService } from '@/services/ticketReportService';

class TicketReportWorker {
  private isInitialized = false;
  private activeExports = 0;
  private readonly MAX_CONCURRENT_EXPORTS = 2;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await ticketReportQueue.initialize();

    // Clean up orphaned temp files older than 1 hour from previous worker crashes
    ticketReportTempFileService.cleanupOldTempFiles();

    const queue = ticketReportQueue.getQueue();

    queue.process('generate-ticket-report', async (job: Bull.Job<TicketReportJobData>) => {
      return this.processJob(job);
    });

    queue.on('failed', (job, err) => {
      logger.error(
        `[TICKET-REPORT-WORKER] Job ${job.id} failed — export ${job.data.exportId}:`,
        err,
      );
    });

    this.isInitialized = true;
    logger.info('[TICKET-REPORT-WORKER] Started, ready to process jobs');
  }

  private async processJob(job: Bull.Job<TicketReportJobData>): Promise<void> {
    const { exportId, workspaceId, requestedByUserId } = job.data;
    logger.info(
      `[TICKET-REPORT-WORKER] Processing job ${job.id} — export ${exportId} in workspace ${workspaceId}`,
    );

    if (this.activeExports >= this.MAX_CONCURRENT_EXPORTS) {
      throw new Error('Too many concurrent exports');
    }

    this.activeExports++;
    try {
      await ticketReportService.generateExport(exportId, workspaceId);
      logger.info(
        `[TICKET-REPORT-WORKER] Successfully generated export ${exportId}`,
      );
    } finally {
      this.activeExports--;
    }
  }

  async shutdown(): Promise<void> {
    await ticketReportQueue.close();
    this.isInitialized = false;
    logger.info('[TICKET-REPORT-WORKER] Shut down');
  }
}

export const ticketReportWorker = new TicketReportWorker();
