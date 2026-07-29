import { ChannelType, VespaInsertionLogs, VespaInsertionStatus, VespaOperationType } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import vespaClient from '@/vespa/client';
import { ticketSchema } from '@/vespa/src/types';
import { descCleaner } from './index';

const ONE_HOUR_MS = 60 * 60 * 1000;
const MIN_INTERVAL_MS = 5000;
const MAX_INTERVAL_MS = ONE_HOUR_MS;
const BATCH_SIZE = 20;
const MAX_RETRIES = config.ticketDescriptionClean?.maxRetries ?? 6;

class TicketCleanupWorkerService {
  private isRunning = false;
  private currentInterval = MIN_INTERVAL_MS;
  private timeoutId?: NodeJS.Timeout;

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.info('[TicketCleanupWorker] Already started');
      return;
    }

    this.isRunning = true;
    logger.info('[TicketCleanupWorker] Started');
    await this.resetProcessingOnStart();
    this.scheduleNextPoll();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    logger.info('[TicketCleanupWorker] Stopped');
  }

  private scheduleNextPoll(): void {
    if (!this.isRunning) return;

    this.timeoutId = setTimeout(async () => {
      try {
        await this.pollAndProcess();
      } catch (error) {
        logger.error('[TicketCleanupWorker] Polling error', error as Error);
      } finally {
        this.scheduleNextPoll();
      }
    }, this.currentInterval);
  }

  private async pollAndProcess(): Promise<void> {
    await this.markMaxRetryFailures();

    const logs = await this.claimFailedCleanupLogs();
    if (logs.length === 0) {
      this.currentInterval = MAX_INTERVAL_MS;
      return;
    }

    this.currentInterval = MIN_INTERVAL_MS;
    const results = await Promise.allSettled(logs.map(log => this.processLog(log)));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length > 0) {
      logger.warn('[TicketCleanupWorker] Batch processing completed with failures', {
        total: logs.length,
        failures: failures.length,
      });
    }
  }

  private async resetProcessingOnStart(): Promise<void> {
    const result = await db.vespaInsertionLogs.updateMany({
      where: {
        type: VespaOperationType.POST_INGEST_CLEAN,
        status: VespaInsertionStatus.PENDING,
      },
      data: {
        status: VespaInsertionStatus.FAILED,
      },
    });

    if (result.count > 0) {
      logger.warn('[TicketCleanupWorker] Reset PENDING cleanup logs on startup', {
        count: result.count,
      });
    }
  }

  private async markMaxRetryFailures(): Promise<void> {
    await db.vespaInsertionLogs.updateMany({
      where: {
        type: VespaOperationType.POST_INGEST_CLEAN,
        status: VespaInsertionStatus.FAILED,
        retryCount: { gte: MAX_RETRIES },
      },
      data: {
        status: VespaInsertionStatus.FAILED_MAX_RETRIES,
        resolvedAt: new Date(),
      },
    });
  }

  private async claimFailedCleanupLogs(): Promise<VespaInsertionLogs[]> {
    return db.$transaction(async tx => {
      const logs = await tx.vespaInsertionLogs.findMany({
        where: {
          type: VespaOperationType.POST_INGEST_CLEAN,
          status: VespaInsertionStatus.FAILED,
          retryCount: { lt: MAX_RETRIES },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BATCH_SIZE,
      });

      if (logs.length === 0) {
        return [];
      }

      const ids = logs.map(log => log.id);
      const claimResult = await tx.vespaInsertionLogs.updateMany({
        where: {
          id: { in: ids },
          status: VespaInsertionStatus.FAILED,
        },
        data: {
          status: VespaInsertionStatus.PENDING,
        },
      });

      if (claimResult.count !== ids.length) {
        logger.warn('[TicketCleanupWorker] Unexpected claim count while marking logs as PENDING', {
          requested: ids.length,
          updated: claimResult.count,
        });
      }

      return logs.map(log => ({
        ...log,
        status: VespaInsertionStatus.PENDING,
      }));
    });
  }

  private async processLog(log: VespaInsertionLogs): Promise<void> {
    try {
      const attempt = log.retryCount + 1;

      const ticket = await db.ticket.findUnique({
        where: { id: log.entityId },
        select: { id: true, title: true, description: true, projectId: true },
      });

      if (!ticket) {
        logger.warn('[TicketCleanupWorker] Ticket not found', {
          ticketId: log.entityId,
          attempt,
        });
        await this.finalizeFailure(log, 'ticket_not_found', true);
        return;
      }

      const cleaned = await descCleaner(ticket.description, ticket.title, ChannelType.EMAIL, ticket.projectId);
      if (!cleaned.usedLlm) {
        const errorMessage = cleaned.llmError || 'llm_cleanup_failed';
        logger.warn('[TicketCleanupWorker] LLM cleanup failed', {
          ticketId: ticket.id,
          attempt,
          error: errorMessage,
        });
        await this.finalizeFailure(log, errorMessage, false);
        return;
      }

      await this.updateVespaTicketDescription(ticket.id, cleaned.description_clean, attempt);
      await this.deleteProcessedLog(log.id, ticket.id, attempt);

      logger.info('[TicketCleanupWorker] Cleanup succeeded', {
        ticketId: ticket.id,
        attempt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[TicketCleanupWorker] Cleanup attempt failed', {
        ticketId: log.entityId,
        attempt: log.retryCount + 1,
        error: message,
      });
      await this.finalizeFailure(log, message, false);
      throw error;
    }
  }

  private async updateVespaTicketDescription(
    ticketId: string,
    descriptionClean: string,
    attempt: number,
  ): Promise<void> {
    try {
      await vespaClient.crudService.update(
        [{ docId: ticketId, fields: { description_clean: descriptionClean } }],
        ticketSchema,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[TicketCleanupWorker] Vespa update failed', {
        ticketId,
        attempt,
        error: message,
      });
      throw new Error(`vespa_update_failed: ${message}`);
    }
  }

  private async deleteProcessedLog(logId: string, ticketId: string, attempt: number): Promise<void> {
    try {
      const result = await db.vespaInsertionLogs.deleteMany({
        where: { id: logId },
      });
      if (result.count !== 1) {
        throw new Error(`cleanup_log_delete_unexpected_count:${result.count}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[TicketCleanupWorker] Failed to delete cleanup log after Vespa update', {
        ticketId,
        logId,
        attempt,
        error: message,
      });
      throw new Error(`cleanup_log_delete_failed: ${message}`);
    }
  }

  private async finalizeFailure(
    log: VespaInsertionLogs,
    reason: string,
    markMax: boolean,
  ): Promise<void> {
    const nextRetryCount = log.retryCount + 1;
    const hitMax = markMax || nextRetryCount >= MAX_RETRIES;

    await db.vespaInsertionLogs.update({
      where: { id: log.id },
      data: {
        status: hitMax ? VespaInsertionStatus.FAILED_MAX_RETRIES : VespaInsertionStatus.FAILED,
        retryCount: nextRetryCount,
        errorMessage: reason,
        errorDetails: {
          reason,
          retryCount: nextRetryCount,
          timestamp: new Date().toISOString(),
        },
        resolvedAt: hitMax ? new Date() : null,
      },
    });
  }

}

export const ticketCleanupWorkerService = new TicketCleanupWorkerService();
