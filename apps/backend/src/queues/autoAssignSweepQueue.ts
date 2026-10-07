import Bull from 'bull';
import { EmailType, TicketStatusV2 } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { DatabaseClient } from '@/database/client';
import { emailClassificationQueue } from '@/queues/emailClassificationQueue';

/**
 * What a sweep covers: one desk, or one user group whose availability just changed.
 */
export type AutoAssignSweepScope = { channelId: string } | { userGroupId: string };

export interface AutoAssignSweepJobData {
  workspaceId: string;
  scope: AutoAssignSweepScope;
  // Who asked for the sweep. Logged only — the classification worker attributes every
  // write it makes to the automations bot, exactly as it does for a new ticket.
  requestedBy: string;
}

const JOB_NAME = 'auto-assign-sweep';

// Ceiling on one sweep, so a desk with a pathological backlog cannot load unbounded rows.
// The stagger is what actually paces the classification worker, which also serves live
// ticket creation.
const MAX_TICKETS_PER_SWEEP = 1000;
const STAGGER_MS = 250;

// Assignment runs once, at ticket creation. A ticket that arrives while no group member is
// available gets no assignee, and nothing retries it — `reassignTicketAwayFrom` only moves
// tickets AWAY from a user, so an unowned ticket stays unowned. This queue is that retry,
// requested rather than polled for:
//
//   - a desk manager asking for it in desk settings (channel scope)
//   - a member becoming available for assignment again (user-group scope)
//
// A job only enqueues. Each ticket then goes through the same classification worker that
// assigns a newly created ticket, so the group write, the assignee write, activities,
// workload sync and websocket updates all have exactly one implementation.
class AutoAssignSweepQueue {
  private queue: Bull.Queue<AutoAssignSweepJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    this.isInitializing = true;

    try {
      const redisConfig = { ...redisService.getRedisConfig(), lazyConnect: false };

      this.queue = new Bull<AutoAssignSweepJobData>('auto-assign-sweep', {
        redis: redisConfig,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      });

      this.setupProcessor();
      this.setupEventListeners();

      this.isInitialized = true;
      logger.info('[AUTO-ASSIGN-SWEEP] Queue initialized successfully');
    } catch (error) {
      logger.error('[AUTO-ASSIGN-SWEEP] Failed to initialize queue:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Request a sweep.
   *
   * Keyed on the scope, so a second request arriving while one is still pending joins it
   * instead of starting a duplicate — which is what happens when a rotation flips several
   * members of a group at once. Returns false in that case, so a caller can say the sweep
   * was already running rather than imply it started a fresh one.
   */
  async enqueue(data: AutoAssignSweepJobData): Promise<{ queued: boolean }> {
    if (!this.queue) {
      throw new Error('Auto-assign sweep queue not initialized');
    }

    const jobId = this.jobIdFor(data.scope);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed') {
        logger.info(`[AUTO-ASSIGN-SWEEP] Sweep already pending for ${jobId}`);
        return { queued: false };
      }
      // removeOnFail keeps a failed job, so its id stays taken. Without clearing it here
      // every later request for this scope would answer "already pending" and no sweep
      // would ever run again.
      await existing.remove();
    }

    await this.queue.add(JOB_NAME, data, { jobId });
    logger.info(`[AUTO-ASSIGN-SWEEP] Queued sweep for ${jobId} (requestedBy=${data.requestedBy})`);
    return { queued: true };
  }

  private jobIdFor(scope: AutoAssignSweepScope): string {
    return 'channelId' in scope ? `sweep:channel:${scope.channelId}` : `sweep:group:${scope.userGroupId}`;
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    this.queue.process(JOB_NAME, async job => {
      const scopeLabel = this.jobIdFor(job.data.scope);
      logger.info(`[AUTO-ASSIGN-SWEEP] Processing job ${job.id} — ${scopeLabel}`);
      const result = await this.sweep(job.data);
      logger.info(
        `[AUTO-ASSIGN-SWEEP] Job ${job.id} completed — ${scopeLabel} ` +
        `enqueued=${result.enqueued} skippedNoEmail=${result.skippedNoEmail} skippedNoGroup=${result.skippedNoGroup}`,
      );
    });
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, error) => {
      logger.error(`[AUTO-ASSIGN-SWEEP] Job ${job?.id} failed:`, error);
    });
    this.queue.on('error', error => {
      logger.error('[AUTO-ASSIGN-SWEEP] Queue error:', error);
    });
  }

  /**
   * Enqueue assignment for every unassigned ticket in scope.
   *
   * Only tickets that came in through a desk conversation are eligible: the classification
   * worker needs the conversation's first email, the same one ticket creation passes it.
   * A ticket created by hand on a desk board has no email and is skipped.
   *
   * `runClassification`/`runPriority` are false — the AI outputs are not what is missing,
   * and skipping them avoids spending LLM quota that live traffic needs.
   */
  private async sweep(
    data: AutoAssignSweepJobData,
  ): Promise<{ enqueued: number; skippedNoEmail: number; skippedNoGroup: number }> {
    const prisma = DatabaseClient.getInstance();
    const { scope, workspaceId } = data;
    const empty = { enqueued: 0, skippedNoEmail: 0, skippedNoGroup: 0 };

    // A ticket with no group of its own inherits its desk's default assignee group, which
    // is what ticket creation does too. For a group-scoped sweep this also identifies the
    // desks the group is responsible for.
    const preferences = await prisma.emailChannelPreference.findMany({
      where:
        'channelId' in scope
          ? { channelId: scope.channelId, assigneeUserGroupId: { not: null } }
          : { assigneeUserGroupId: scope.userGroupId },
      select: { channelId: true, assigneeUserGroupId: true },
    });
    const defaultGroupByChannel = new Map(
      preferences.map(p => [p.channelId, p.assigneeUserGroupId as string]),
    );

    const tickets = await prisma.ticket.findMany({
      where: {
        workspaceId,
        assignedTo: null,
        isArchived: false,
        // COMPLETED/CANCELLED are the only statuses worth excluding — a paused ticket
        // with nobody on it is still a ticket nobody owns.
        statusV2: { notIn: [TicketStatusV2.COMPLETED, TicketStatusV2.CANCELLED] },
        ...('channelId' in scope
          ? { channelId: scope.channelId }
          : {
              // The group's own tickets, plus tickets that never got a group on the desks
              // this group is the default for.
              OR: [
                { userGroupId: scope.userGroupId },
                { userGroupId: null, channelId: { in: [...defaultGroupByChannel.keys()] } },
              ],
            }),
      },
      select: { id: true, channelId: true, conversationId: true, userGroupId: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_TICKETS_PER_SWEEP,
    });
    if (tickets.length === 0) return empty;
    if (tickets.length === MAX_TICKETS_PER_SWEEP) {
      logger.warn(
        `[AUTO-ASSIGN-SWEEP] ${this.jobIdFor(scope)} hit the ${MAX_TICKETS_PER_SWEEP}-ticket ceiling; ` +
        'tickets beyond it are not covered by this sweep.',
      );
    }

    // One email per conversation, the same one ticket creation passes. Prisma applies
    // `distinct` in memory here, so this still reads every matching email row and narrows
    // afterwards — fine for the two selected columns, worth knowing before widening them.
    const emails = await prisma.email.findMany({
      where: {
        conversationId: { in: tickets.map(t => t.conversationId) },
        type: { not: EmailType.COMPOSE },
      },
      select: { id: true, conversationId: true },
      orderBy: [{ conversationId: 'asc' }, { createdAt: 'asc' }],
      distinct: ['conversationId'],
    });
    const firstEmailByConversation = new Map(emails.map(e => [e.conversationId, e.id] as const));

    let enqueued = 0;
    let skippedNoEmail = 0;
    let skippedNoGroup = 0;
    let staggerIdx = 0;

    for (const ticket of tickets) {
      const emailId = firstEmailByConversation.get(ticket.conversationId);
      if (!emailId) {
        skippedNoEmail++;
        continue;
      }

      // With no group there is nothing to pick an assignee from, so enqueuing would burn a
      // job and a claim to do nothing.
      const groupId = ticket.userGroupId ?? defaultGroupByChannel.get(ticket.channelId) ?? null;
      if (!groupId) {
        skippedNoGroup++;
        continue;
      }

      // No per-ticket dedup on purpose. A second sweep re-enqueuing a ticket is a no-op:
      // the worker re-reads it and does nothing once it has an assignee. Any claim that
      // outlived one sweep would do real harm instead — it would make the next
      // availability change skip the tickets that are still unassigned, which is exactly
      // what that trigger exists to retry.
      await emailClassificationQueue.getQueue().add(
        'classify',
        {
          ticketId: ticket.id,
          channelId: ticket.channelId,
          emailId,
          groupId,
          runClassification: false,
          runPriority: false,
          runAssignment: true,
        },
        { delay: staggerIdx * STAGGER_MS },
      );
      enqueued++;
      staggerIdx++;
    }

    return { enqueued, skippedNoEmail, skippedNoGroup };
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[AUTO-ASSIGN-SWEEP] Queue closed');
    }
  }
}

export const autoAssignSweepQueue = new AutoAssignSweepQueue();
