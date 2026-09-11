import type Bull from 'bull';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { deskReportGenerationService } from '@/services/deskReportGenerationService';

/**
 * Desk Report generation worker — \Sweeps every
 * deskReportEnabled desk and dispatches a Claw agent run per desk; each
 * reports back asynchronously via deskReportCallback.handler.ts.
 */
export class DeskReportWorker {
  async processGenerationJob(job: Bull.Job): Promise<{ total: number; dispatched: number; failed: number }> {
    logger.info(`[DESK_REPORT_WORKER] Processing generation job ${job.id || 'manual'}...`);
    try {
      const result = await deskReportGenerationService.generateReportsForEnabledDesks();
      if (result.failed > 0) {
        const failedChannels = result.results.filter((r) => !r.success);
        logger.error('[DESK_REPORT_WORKER] Failed channels:', failedChannels);
      }
      return { total: result.total, dispatched: result.dispatched, failed: result.failed };
    } catch (error) {
      logger.error('[DESK_REPORT_WORKER] Generation job failed:', error);
      throw error;
    }
  }

  async processCleanupJob(job: Bull.Job<{ retentionDays?: number }>): Promise<{ deletedRows: number; deletedFiles: number }> {
    logger.info(`[DESK_REPORT_WORKER] Processing cleanup job ${job.id || 'manual'}...`);
    try {
      const retentionDays = job.data?.retentionDays || config.deskReportScheduler.retentionDays;
      return await deskReportGenerationService.cleanupOldReports(retentionDays);
    } catch (error) {
      logger.error('[DESK_REPORT_WORKER] Cleanup job failed:', error);
      throw error;
    }
  }
}

export const deskReportWorker = new DeskReportWorker();
