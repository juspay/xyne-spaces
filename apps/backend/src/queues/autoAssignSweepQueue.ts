import Bull from 'bull';
import { EmailType, TicketStatusV2 } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { DatabaseClient } from '@/database/client';
import { emailClassificationQueue, type EmailClassificationJobData } from '@/queues/emailClassificationQueue';

export interface AutoAssignSweepJobData {
  channelId: string;
  workspaceId: string;
  // Who asked for the sweep. Logged only — the classification worker attributes every
  // write it makes to the automations bot, exactly as it does for a new ticket.
  requestedBy: string;
  // Ticket creation window to sweep, as ISO strings (Bull serialises job data to JSON, so
  // a Date would arrive back as a string anyway). Required: the caller picks the window,
  // so a press can never mean "the entire history of this desk" by accident.
  createdFrom: string;
  createdTo: string;
}

const JOB_NAME = 'auto-assign-sweep';

// How many tickets one sweep will enqueue.
const MAX_JOBS_PER_SWEEP = 1000;
const SCAN_PAGE_SIZE = 500;

// The stagger is what paces the classification worker, which also serves live ticket
// creation.
const STAGGER_MS = 250;

// Assignment runs once, at ticket creation. A ticket that arrives while no group member is
// available gets no assignee, and nothing retries it — `reassignTicketAwayFrom` only moves
// tickets AWAY from a user, so an unowned ticket stays unowned. This queue is that retry,
// run on request: a desk manager who can see their group is staffed again presses
// "Auto-assign now" in desk settings.
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
          removeOnComplete: false,
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
   * Request a sweep of one desk.
   *
   * Keyed on the channel, not on the requested window: one sweep per desk at a time,
   * whatever window the second request asked for. A request arriving while the previous
   * sweep is still queued, running, or draining its classification jobs is refused rather
   * than started, and returns false so the caller can say the sweep was already running
   * instead of implying it began a fresh one.
   */
  async enqueue(data: AutoAssignSweepJobData): Promise<{ queued: boolean }> {
    if (!this.queue) {
      throw new Error('Auto-assign sweep queue not initialized');
    }

    const jobId = `sweep:channel:${data.channelId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed') {
        logger.info(`[AUTO-ASSIGN-SWEEP] Sweep already pending for channel ${data.channelId}`);
        return { queued: false };
      }
      if (state === 'completed') {
        const { lastJobId } = (existing.returnvalue ?? {}) as { lastJobId?: string | null };
        if (lastJobId) {
          const pending = await emailClassificationQueue.getQueue().getJob(lastJobId);
          if (pending) {
            logger.info(
              `[AUTO-ASSIGN-SWEEP] Sweep for channel ${data.channelId} is still draining ` +
              `(${lastJobId} not run yet)`,
            );
            return { queued: false };
          }
        }
      }
      // Drained, or failed. Either way the id is still taken — neither removeOnComplete
      // nor removeOnFail clears it — so drop it here, or every later request for this desk
      // would answer "already pending" and no sweep would ever run again.
      await existing.remove();
    }

    await this.queue.add(JOB_NAME, data, { jobId });
    logger.info(
      `[AUTO-ASSIGN-SWEEP] Queued sweep for channel ${data.channelId} ` +
      `(requestedBy=${data.requestedBy} window=${data.createdFrom}..${data.createdTo})`,
    );
    return { queued: true };
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    this.queue.process(JOB_NAME, async job => {
      const { channelId, createdFrom, createdTo } = job.data;
      logger.info(
        `[AUTO-ASSIGN-SWEEP] Processing job ${job.id} — channel ${channelId} window ${createdFrom}..${createdTo}`,
      );
      const result = await this.sweep(job.data);
      logger.info(
        `[AUTO-ASSIGN-SWEEP] Job ${job.id} completed — channel ${channelId} ` +
        `enqueued=${result.enqueued} skippedNoEmail=${result.skippedNoEmail} skippedNoGroup=${result.skippedNoGroup}`,
      );
      return result;
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
   * Enqueue assignment for every unassigned ticket on the desk created inside the
   * requested window.
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
  ): Promise<{
    enqueued: number;
    skippedNoEmail: number;
    skippedNoGroup: number;
    lastJobId: string | null;
  }> {
    const prisma = DatabaseClient.getInstance();
    const { channelId, workspaceId } = data;

    // A ticket with no group of its own inherits the desk's default assignee group, which
    // is what ticket creation does too.
    const preference = await prisma.emailChannelPreference.findUnique({
      where: { channelId },
      select: { assigneeUserGroupId: true },
    });
    const defaultGroupId = preference?.assigneeUserGroupId ?? null;

    const where = {
      channelId,
      workspaceId,
      assignedTo: null,
      isArchived: false,
      // COMPLETED/CANCELLED are the only statuses worth excluding — a paused ticket with
      // nobody on it is still a ticket nobody owns.
      statusV2: { notIn: [TicketStatusV2.COMPLETED, TicketStatusV2.CANCELLED] },
      createdAt: { gte: new Date(data.createdFrom), lte: new Date(data.createdTo) },
    };

    let totalJobs = 0;
    let skippedNoEmail = 0;
    let skippedNoGroup = 0;
    let cursorId: string | undefined;
    // The highest-delay job queued, i.e. the last one to run — see `enqueue`.
    let lastJobId: string | null = null;
    
    // Paged rather than one capped read: eligibility (has an email, has a group) cannot be
    // expressed in the query — Email has no relation to Conversation — so a single `take`
    // would hand back a page of ineligible tickets and stop there. A desk carrying a large
    // bulk-import backlog would never reach the tickets that can actually be assigned.
    while (totalJobs < MAX_JOBS_PER_SWEEP) {
      const page = await prisma.ticket.findMany({
        where,
        select: { id: true, channelId: true, conversationId: true, userGroupId: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: SCAN_PAGE_SIZE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (page.length === 0) break;
      
      cursorId = page[page.length - 1].id;
      
      // One email per conversation, the same one ticket creation passes. Prisma applies
      // `distinct` in memory, so this reads every matching email row for the page and
      // narrows afterwards — fine for the two selected columns, worth knowing before
      // widening them.
      const emails = await prisma.email.findMany({
        where: {
          conversationId: { in: page.map(t => t.conversationId) },
          type: { not: EmailType.COMPOSE },
        },
        select: { id: true, conversationId: true },
        orderBy: [{ conversationId: 'asc' }, { createdAt: 'asc' }],
        distinct: ['conversationId'],
      });
      const firstEmailByConversation = new Map(emails.map(e => [e.conversationId, e.id] as const));
      const jobs: Array<{
        name: string;
        data: EmailClassificationJobData;
        opts: { delay: number; jobId: string; removeOnFail: boolean };
      }> = [];

      for (const ticket of page) {
        if (totalJobs >= MAX_JOBS_PER_SWEEP) break;

        const emailId = firstEmailByConversation.get(ticket.conversationId);
        if (!emailId) {
          // Not a desk-ingested ticket (hand-created, bulk import), or an outbound-only
          // thread the worker could not assign anyway.
          skippedNoEmail++;
          continue;
        }

        // With no group there is nothing to pick an assignee from, so enqueuing would burn
        // a job to do nothing.
        const groupId = ticket.userGroupId ?? defaultGroupId;
        if (!groupId) {
          skippedNoGroup++;
          continue;
        }

        const jobId = `sweep-assign:${ticket.id}`;
        jobs.push({
          name: 'classify',
          data: {
            ticketId: ticket.id,
            channelId: ticket.channelId,
            emailId,
            groupId,
            runClassification: false,
            runPriority: false,
            runAssignment: true,
          },
          opts: {
            delay: totalJobs * STAGGER_MS,
            jobId,
            removeOnFail: true,
          },
        });
        lastJobId = jobId;
        totalJobs++;
      }

      if (jobs.length > 0) {
        await emailClassificationQueue.getQueue().addBulk(jobs);
      }

      if (page.length < SCAN_PAGE_SIZE) break;
    }

    if (totalJobs === MAX_JOBS_PER_SWEEP) {
      logger.warn(
        `[AUTO-ASSIGN-SWEEP] Channel ${channelId} stopped at its budget ` +
        `(enqueued=${totalJobs}); press Auto-assign now again to continue.`,
      );
    }

    return { enqueued: totalJobs, skippedNoEmail, skippedNoGroup, lastJobId };
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
