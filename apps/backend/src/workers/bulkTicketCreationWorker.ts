import type { Job } from 'bull';
import { logger } from '@/utils/logger';
import {
  bulkTicketCreationQueue,
  BULK_TICKET_JOB_NAME,
} from '@/queues/bulkTicketCreationQueue';
import { TicketController } from '@/controllers/ticketController';
import { validateChannelAccess } from '@/utils/channelAccess';
import { createSubTicket } from '@/services/subTicketService';
import {
  BulkTicketCreationJobData,
  BulkTicketMode,
} from '@/types/bulkTicket';

/**
 * Processes bulk-ticket-creation batches off the request path.
 *
 * Design notes:
 *  - Every item is access-checked again here ({@link validateChannelAccess}),
 *    not just at enqueue time, so a job can never create a ticket in a channel
 *    the requester cannot reach even if the payload is tampered with.
 *  - Per-row idempotency: completed `clientRowId`s are recorded in a Redis set
 *    keyed by the batch `jobKey`. If the job stalls and Bull re-runs it, rows
 *    that already succeeded are skipped instead of duplicated.
 *  - Failures are collected and reported once at the end of the run (single
 *    site), never per item and never per retry attempt.
 */
class BulkTicketCreationWorker {
  private isInitialized = false;
  private readonly ticketController = new TicketController();

  async start(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await bulkTicketCreationQueue.initialize();
    const queue = bulkTicketCreationQueue.getQueue();

    queue.process(BULK_TICKET_JOB_NAME, 1, async (job) => this.processJob(job));

    queue.on('failed', (job, err) => {
      logger.error(`[BULK-TICKET-WORKER] Job ${job?.id} failed:`, err);
    });

    this.isInitialized = true;
    logger.info('[BULK-TICKET-WORKER] Started, ready to process jobs');
  }

  private async processJob(job: Job<BulkTicketCreationJobData>): Promise<void> {
    const data = job.data;
    const client = bulkTicketCreationQueue.getQueue().client;
    const doneKey = `bulk-ticket:done:${data.jobKey}`;

    const failures: Array<{ title: string; reason: string }> = [];
    let created = 0;
    let skipped = 0;

    for (let index = 0; index < data.items.length; index += 1) {
      const item = data.items[index]!;
      const rowId = item.clientRowId ?? String(index);

      // Idempotency: skip rows a prior (stalled/retried) run already created.
      const alreadyDone = await client.sismember(doneKey, rowId);
      if (alreadyDone) {
        skipped += 1;
        continue;
      }

      try {
        const access = await validateChannelAccess(
          item.channelId,
          data.createdBy,
          data.workspaceId,
        );
        if (!access.hasAccess) {
          failures.push({ title: item.title, reason: access.reason ?? 'Access denied' });
          continue;
        }

        const ticket = await this.ticketController.createBulkTicketItem(item, data.createdBy);

        if (data.mode === BulkTicketMode.PARENT_SUB && data.parentTicketId) {
          await createSubTicket({
            parentTicketId: data.parentTicketId,
            title: item.title,
            description: item.description ?? null,
            createdBy: data.createdBy,
            assignedTo: item.assignedTo ?? null,
            mappedTicketId: ticket.id,
          });
        }

        await client.sadd(doneKey, rowId);
        created += 1;
      } catch (error) {
        logger.error('[BULK-TICKET-WORKER] Failed to create ticket', {
          jobKey: data.jobKey,
          title: item.title,
          error,
        });
        failures.push({
          title: item.title,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Keep the idempotency marker briefly after completion, then let it expire.
    await client.expire(doneKey, 24 * 60 * 60);

    logger.info('[BULK-TICKET-WORKER] Batch complete', {
      jobKey: data.jobKey,
      total: data.items.length,
      created,
      skipped,
      failed: failures.length,
    });

    if (failures.length > 0) {
      // Single terminal failure-report site (not per-item, not per-attempt).
      logger.warn('[BULK-TICKET-WORKER] Some tickets in the batch failed', {
        jobKey: data.jobKey,
        failures,
      });
    }
  }

  async shutdown(): Promise<void> {
    await bulkTicketCreationQueue.close();
    this.isInitialized = false;
    logger.info('[BULK-TICKET-WORKER] Shut down');
  }
}

export const bulkTicketCreationWorker = new BulkTicketCreationWorker();
