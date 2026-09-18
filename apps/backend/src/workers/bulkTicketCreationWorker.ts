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

const plural = (count: number): string => (count === 1 ? '' : 's');

/** Nudge title for a batch that failed to create rows, to link them, or both. */
const summariseFailures = (failed: number, unlinked: number): string => {
  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} ticket${plural(failed)} failed to create`);
  if (unlinked > 0) parts.push(`${unlinked} not linked to the parent`);
  return parts.join(', ');
};

/**
 * Processes bulk-ticket-creation batches off the request path.
 *
 * Design notes:
 *  - Every item is access-checked again here ({@link validateChannelAccess}),
 *    not just at enqueue time, so a job can never create a ticket in a channel
 *    the requester cannot reach even if the payload is tampered with.
 *  - Per-row idempotency: a row's ticket id is recorded in Redis as soon as the
 *    ticket exists, and the row counts as done only once it is linked as well.
 *    A re-run therefore skips finished rows, and finishes the link for a row
 *    whose ticket was already created rather than creating a second one.
 *  - Failures are collected and a single failure nudge is created on the last
 *    attempt that will run (not per-item, not per-attempt) so the user can
 *    retry failed tickets from the nudge card. It hangs off the best message
 *    the batch has ({@link BulkTicketCreationWorker.resolveNudgeAnchor}),
 *    because a nudge with nothing to hang off is never shown to anyone.
 *  - Throws if every ticket failed, and if any ticket is left unlinked, so Bull
 *    gives those links another attempt. Partial creation failures do not throw:
 *    re-creating is the user's call, offered through the nudge.
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
    const ticketKey = `bulk-ticket:ticket:${job.id}`;

    const parentTicketId = await this.resolveParentTicket(job, client);

    const failures: Array<{ input: BulkTicketCreationInput; error: string }> = [];
    const linkFailures: Array<{ input: BulkTicketCreationInput; ticketId: string; error: string }> =
      [];
    let created = 0;
    let skipped = 0;
    let relinked = 0;
    // All-parents batches have no parent and may have no source: the first
    // ticket the batch manages to create is then the only place a nudge can go.
    let firstCreatedTicketId: string | null = null;

    for (let index = 0; index < data.subTickets.length; index += 1) {
      const item = data.subTickets[index]!;
      const rowId = item.clientRowId || String(index);

      const alreadyDone = await client.sismember(doneKey, rowId);
      if (alreadyDone) {
        skipped += 1;
        continue;
      }

      // Set only once the ticket exists, so the catch below can tell a ticket
      // that was never created from one that was created but not linked.
      let ticketId = await client.hget(ticketKey, rowId);

      try {
        const access = await validateChannelAccess(
          item.channelId,
          data.userId,
          data.parentWorkspaceId,
        );
        if (!access.hasAccess) {
          const reason = access.reason ?? 'Access denied';
          if (ticketId) {
            linkFailures.push({ input: item, ticketId, error: reason });
          } else {
            failures.push({ input: item, error: reason });
          }
          continue;
        }

        if (ticketId) {
          // A previous attempt created this ticket and failed on the link.
          relinked += 1;
        } else {
          const ticket = await this.ticketController.createBulkTicketItem(item, data.userId, {
            fromTicketsTab: data.fromTicketsTab === true,
          });
          ticketId = ticket.id;
          await client.hset(ticketKey, rowId, ticketId);
          firstCreatedTicketId ??= ticketId;
          created += 1;
        }

        if (data.mode === BulkTicketMode.PARENT_SUB && parentTicketId) {
          await createSubTicket({
            parentTicketId,
            title: item.title,
            description: item.description ?? null,
            createdBy: data.userId,
            assignedTo: item.assignedTo ?? null,
            mappedTicketId: ticketId,
          });
        }

        // Done means created *and* linked. A row that got its ticket but not
        // its link stays open, so the next attempt can finish it.
        await client.sadd(doneKey, rowId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';

        if (ticketId) {
          logger.error('[BULK-TICKET-WORKER] Ticket created but not linked to its parent', {
            jobId: job.id,
            ticketId,
            parentTicketId,
            error,
          });
          linkFailures.push({ input: item, ticketId, error: message });
          continue;
        }

        logger.error('[BULK-TICKET-WORKER] Failed to create ticket', {
          jobId: job.id,
          title: item.title,
          error,
        });
        failures.push({ input: item, error: message });
      }
    }

    await client.expire(doneKey, 24 * 60 * 60);
    await client.expire(ticketKey, 24 * 60 * 60);

    logger.info('[BULK-TICKET-WORKER] Batch complete', {
      jobId: job.id,
      total: data.subTickets.length,
      created,
      skipped,
      relinked,
      failed: failures.length,
      unlinked: linkFailures.length,
    });

    const isTotalFailure = failures.length === data.subTickets.length && data.subTickets.length > 0;
    // Unlinked rows are worth another attempt on their own: the retry only has
    // the link left to do, so it is cheap and cannot duplicate a ticket.
    const hasMoreAttempts = job.attemptsMade + 1 < (job.opts?.attempts ?? 1);
    const willRetry = (isTotalFailure || linkFailures.length > 0) && hasMoreAttempts;

    if (failures.length > 0 || linkFailures.length > 0) {
      logger.warn('[BULK-TICKET-WORKER] Some tickets in the batch failed', {
        jobId: job.id,
        willRetry,
        failures: failures.map(f => ({ title: f.input.title, error: f.error })),
        unlinked: linkFailures.map(l => ({
          title: l.input.title,
          ticketId: l.ticketId,
          error: l.error,
        })),
      });

      if (!willRetry) {
        const anchorMessageId = await this.resolveNudgeAnchor({
          data,
          parentTicketId,
          fallbackTicketId: firstCreatedTicketId,
        });

        if (anchorMessageId && data.projectId) {
          await this.createFailureNudge({
            jobId: job.id,
            data,
            parentTicketId,
            anchorMessageId,
            failures,
            linkFailures,
          });
        } else {
          logger.warn('[BULK-TICKET-WORKER] Nowhere to put the failure nudge', {
            jobId: job.id,
            anchorMessageId,
            projectId: data.projectId,
            failureCount: failures.length + linkFailures.length,
          });
        }
      }
    }

    if (isTotalFailure) {
      throw new Error(`All ${data.subTickets.length} ticket(s) failed to create`);
    }

    // Throwing hands the remaining links back to Bull; the rows that are done
    // are skipped on the next attempt, so only the links are retried.
    if (linkFailures.length > 0) {
      throw new Error(
        `${linkFailures.length} ticket(s) created but not linked to parent ${parentTicketId}`,
      );
    }
  }

  /**
   * The parent of a parent-sub batch, created here rather than at enqueue time.
   * Its id is remembered per job, so a retry links to the parent the first
   * attempt made instead of creating a second one.
   */
  private async resolveParentTicket(
    job: Job<BulkTicketCreationJobData>,
    client: ReturnType<typeof bulkTicketCreationQueue.getQueue>['client'],
  ): Promise<string | null> {
    const data = job.data;
    if (data.parentTicketId) return data.parentTicketId;
    if (!data.parent) return null;

    const parentKey = `bulk-ticket:parent:${job.id}`;
    const existing = await client.get(parentKey);
    if (existing) return existing;

    const access = await validateChannelAccess(
      data.parent.channelId,
      data.userId,
      data.parentWorkspaceId,
    );
    if (!access.hasAccess) {
      throw new Error(`Parent ticket channel is not accessible: ${access.reason ?? 'Access denied'}`);
    }

    const parent = await this.ticketController.createBulkTicketItem(data.parent, data.userId, {
      fromTicketsTab: data.fromTicketsTab === true,
    });
    await client.set(parentKey, parent.id, 'EX', 24 * 60 * 60);
    return parent.id;
  }

  /**
   * The message a failure nudge can hang off. Nudges are only rendered under a
   * message, so this walks from the most specific anchor a batch has to the
   * least: the message a retry came from, the parent ticket's own creation
   * message (every parent-sub batch has one), the conversation the batch was
   * started from, and finally the first ticket the batch created — which for a
   * tickets-tab batch is the only thing that exists.
   */
  private async resolveNudgeAnchor({
    data,
    parentTicketId,
    fallbackTicketId,
  }: {
    data: BulkTicketCreationJobData;
    parentTicketId: string | null;
    fallbackTicketId: string | null;
  }): Promise<string | null> {
    if (data.sourceMessageId) return data.sourceMessageId;

    for (const ticketId of [parentTicketId, fallbackTicketId]) {
      if (!ticketId) continue;
      // `messageId` is the ticket's creation message — the head of its thread,
      // which is where the ticket card itself renders.
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { messageId: true },
      });
      if (ticket?.messageId) return ticket.messageId;
    }

    if (data.sourceConversationId) {
      const conversation = await prisma.conversation.findUnique({
        where: { conversationId: data.sourceConversationId },
        select: { initialMessageId: true },
      });
      if (conversation?.initialMessageId) return conversation.initialMessageId;
    }

    return null;
  }

  /**
   * One nudge for everything that needs attention. Only `failures` go into
   * `failedInputs`, because that is what the card's Retry re-creates — a row
   * whose ticket already exists must never be re-created, so unlinked rows are
   * named in the description instead and left for the user to link.
   */
  private async createFailureNudge({
    jobId,
    data,
    parentTicketId,
    anchorMessageId,
    failures,
    linkFailures,
  }: {
    jobId: string | number;
    data: BulkTicketCreationJobData;
    parentTicketId: string | null;
    anchorMessageId: string;
    failures: Array<{ input: BulkTicketCreationInput; error: string }>;
    linkFailures: Array<{ input: BulkTicketCreationInput; ticketId: string; error: string }>;
  }): Promise<void> {
    try {
      let existingParentTicket: { id: string; xyneId: string; conversationId: string } | null = null;
      let parentTitle: string | null = null;
      if (parentTicketId) {
        const parent = await prisma.ticket.findUnique({
          where: { id: parentTicketId },
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
        sourceId: anchorMessageId,
        sourceType: (data.sourceType as SurfaceAreaType) ?? SurfaceAreaType.MESSAGE,
        nudgeKind: NudgeKind.BULK_TICKET_CREATION_FAILED,
        workspaceId: data.parentWorkspaceId,
        priority: 'high',
        candidates: [
          {
            title: summariseFailures(failures.length, linkFailures.length),
            description: [
              ...failures.map(f => `• ${f.input.title}`),
              ...linkFailures.map(
                l => `• ${l.input.title} — created, but not linked to the parent`,
              ),
            ].join('\n'),
            priority: 'high',
            actions: {
              actionType: 'RETRY_BULK_TICKET_CREATION',
              mode: parentTicketId ? 'parent-sub' : 'all-parents',
              channelId: data.channelId,
              projectId: data.projectId,
              parentTicketId,
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
