import type { Job } from 'bull';
import { logger } from '@/utils/logger';
import {
  bulkTicketCreationQueue,
  BULK_TICKET_JOB_NAME_SUB,
  BULK_TICKET_JOB_NAME_BULK,
} from '@/queues/bulkTicketCreationQueue';
import { TicketController } from '@/controllers/ticketController';
import { validateChannelAccess } from '@/utils/channelAccess';
import { createSubTicket } from '@/services/subTicketService';
import { runWithContext } from '@/database/tenant/context';
import { nudgeService } from '@/nudges/services/surfaceNudgeService';
import {
  BulkTicketCreationJobData,
  BulkTicketCreationInput,
  BulkTicketMode,
} from '@/types/bulkTicket';
import { NudgeKind, SurfaceAreaType } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';

const prisma = DatabaseClient.getInstance();

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
 *  - Failures are collected and a single failure nudge is created at the end
 *    of the run (not per-item, not per-attempt) so the user can retry failed
 *    tickets from the nudge card.
 *  - Throws only if every ticket failed, so Bull retries make sense for
 *    transient total failures. Partial failures are reported via nudge.
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

    queue.process(BULK_TICKET_JOB_NAME_SUB, 5, async (job: Job<BulkTicketCreationJobData>) => {
      return runWithContext(
        { userId: job.data.userId, workspaceId: job.data.parentWorkspaceId },
        () => this.processJob(job),
      );
    });

    queue.process(BULK_TICKET_JOB_NAME_BULK, 5, async (job: Job<BulkTicketCreationJobData>) => {
      return runWithContext(
        { userId: job.data.userId, workspaceId: job.data.parentWorkspaceId },
        () => this.processJob(job),
      );
    });

    queue.on('failed', (job, err) => {
      logger.error(`[BULK-TICKET-WORKER] Job ${job?.id} failed:`, err);
    });

    queue.on('stalled', (job) => {
      logger.warn(`[BULK-TICKET-WORKER] Job ${job?.id} stalled`);
    });

    this.isInitialized = true;
    logger.info('[BULK-TICKET-WORKER] Started, ready to process jobs');
  }

  private async processJob(job: Job<BulkTicketCreationJobData>): Promise<void> {
    const data = job.data;
    const client = bulkTicketCreationQueue.getQueue().client;
    const doneKey = `bulk-ticket:done:${job.id}`;

    const failures: Array<{ input: BulkTicketCreationInput; error: string }> = [];
    let created = 0;
    let skipped = 0;

    for (let index = 0; index < data.subTickets.length; index += 1) {
      const item = data.subTickets[index]!;
      const rowId = item.clientRowId ?? String(index);

      const alreadyDone = await client.sismember(doneKey, rowId);
      if (alreadyDone) {
        skipped += 1;
        continue;
      }

      try {
        const access = await validateChannelAccess(
          item.channelId,
          data.userId,
          data.parentWorkspaceId,
        );
        if (!access.hasAccess) {
          failures.push({ input: item, error: access.reason ?? 'Access denied' });
          continue;
        }

        const ticket = await this.ticketController.createBulkTicketItem(item, data.userId);

        if (data.mode === BulkTicketMode.PARENT_SUB && data.parentTicketId) {
          await createSubTicket({
            parentTicketId: data.parentTicketId,
            title: item.title,
            description: item.description ?? null,
            createdBy: data.userId,
            assignedTo: item.assignedTo ?? null,
            mappedTicketId: ticket.id,
          });
        }

        await client.sadd(doneKey, rowId);
        created += 1;
      } catch (error) {
        logger.error('[BULK-TICKET-WORKER] Failed to create ticket', {
          jobId: job.id,
          title: item.title,
          error,
        });
        failures.push({
          input: item,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    await client.expire(doneKey, 24 * 60 * 60);

    logger.info('[BULK-TICKET-WORKER] Batch complete', {
      jobId: job.id,
      total: data.subTickets.length,
      created,
      skipped,
      failed: failures.length,
    });

    if (failures.length > 0) {
      logger.warn('[BULK-TICKET-WORKER] Some tickets in the batch failed', {
        jobId: job.id,
        failures: failures.map(f => ({ title: f.input.title, error: f.error })),
      });

      if (data.sourceMessageId && data.projectId) {
        await this.createFailureNudge({
          jobId: job.id,
          data,
          failures,
        });
      } else {
        logger.warn('[BULK-TICKET-WORKER] Skipping failure nudge — missing sourceMessageId or projectId', {
          jobId: job.id,
          sourceMessageId: data.sourceMessageId,
          projectId: data.projectId,
          failureCount: failures.length,
        });
      }
    }

    if (failures.length === data.subTickets.length && data.subTickets.length > 0) {
      throw new Error(`All ${data.subTickets.length} ticket(s) failed to create`);
    }
  }

  private async createFailureNudge({
    jobId,
    data,
    failures,
  }: {
    jobId: string | number;
    data: BulkTicketCreationJobData;
    failures: Array<{ input: BulkTicketCreationInput; error: string }>;
  }): Promise<void> {
    try {
      let existingParentTicket: { id: string; xyneId: string; conversationId: string } | null = null;
      let parentTitle: string | null = null;
      if (data.parentTicketId) {
        const parent = await prisma.ticket.findUnique({
          where: { id: data.parentTicketId },
          select: { id: true, xyneId: true, conversationId: true, title: true },
        });
        if (parent) {
          existingParentTicket = parent;
          parentTitle = parent.title;
        }
      }

      const failedInputs = failures.map(f => ({
        title: f.input.title,
        description: f.input.description,
        priority: f.input.priority,
        statusV2: f.input.statusV2,
        eta: f.input.eta ? new Date(f.input.eta).toISOString() : null,
        channelId: f.input.channelId,
        boardId: f.input.boardId,
        assignedTo: f.input.assignedTo,
        userGroupId: f.input.userGroupId,
        tags: f.input.tags,
        ticketType: f.input.ticketType,
        stageName: f.input.stageName,
        dynamicFields: f.input.dynamicFields,
        merchantId: f.input.merchantId,
        clientRowId: f.input.clientRowId,
      }));

      await nudgeService.persistCandidates({
        sourceId: data.sourceMessageId!,
        sourceType: (data.sourceType as SurfaceAreaType) ?? SurfaceAreaType.MESSAGE,
        nudgeKind: NudgeKind.BULK_TICKET_CREATION_FAILED,
        projectId: data.projectId!,
        priority: 'high',
        candidates: [
          {
            title: `${failures.length} ticket${failures.length === 1 ? '' : 's'} failed to create`,
            description: failures.map(f => `• ${f.input.title}`).join('\n'),
            priority: 'high',
            actions: {
              actionType: 'RETRY_BULK_TICKET_CREATION',
              mode: data.parentTicketId ? 'parent-sub' : 'all-parents',
              channelId: data.channelId,
              projectId: data.projectId,
              parentTicketId: data.parentTicketId,
              parentTitle,
              existingParentTicket,
              failedInputs,
            },
            visibleTo: failures[0]?.input.createdBy,
          },
        ],
      });
      logger.info(`[BULK-TICKET-WORKER] Created failure nudge for job ${jobId}`);
    } catch (nudgeErr) {
      logger.error('[BULK-TICKET-WORKER] Failed to create failure nudge', {
        jobId,
        error: nudgeErr instanceof Error ? nudgeErr.message : String(nudgeErr),
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
