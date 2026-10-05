import Bull from 'bull';
import { EmailType, TicketStatusV2 } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { DatabaseClient } from '@/database/client';
import { emailClassificationQueue } from '@/queues/emailClassificationQueue';
import { userAssignmentStateService } from '@/services/userAssignmentStateService';

export type AssignmentBackfillJobType = 'assignment-backfill';

const EVERY_15_MIN_CRON = '*/15 * * * *';
const REPEATABLE_JOB_ID = 'assignment-backfill-repeatable';

// Enough to drain a multi-thousand backlog over a few hours without flooding the
// classification worker, which also serves live ticket creation.
const MAX_TICKETS_PER_RUN = 200;
const STAGGER_MS = 250;

// The first run after deploy would otherwise walk every historical expired marker in one
// pass, sequentially.
const MAX_PAUSE_RESTORES_PER_RUN = 100;

// Only recent tickets are worth backfilling. Without this the sweeper permanently churns
// through historical bulk-ingest tickets.
const MAX_TICKET_AGE_DAYS = 30;

// Dedup lives in Redis, not in the Bull jobId: the classification queue sets
// removeOnComplete, so a jobId is free again the moment its job finishes and would not
// hold a ticket back at all.
const DEDUP_TTL_SECONDS = 60 * 60;

// Assignment runs once at ticket creation. A ticket created while no group member was
// available gets no assignee, and nothing retries it — `reassignTicketAwayFrom` only moves
// tickets AWAY from a user, so an unowned ticket stays unowned forever. This sweeper is
// that missing retry.
//
// Two steps, in order, because the second depends on the first:
//   1. Restore members whose pause has expired (their scheduled restore may have been lost).
//   2. Re-run assignment for tickets that never got an assignee.
class AssignmentBackfillQueue {
  private queue: Bull.Queue<{ type: AssignmentBackfillJobType }> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    this.isInitializing = true;

    try {
      const redisConfig = { ...redisService.getRedisConfig(), lazyConnect: false };

      this.queue = new Bull<{ type: AssignmentBackfillJobType }>('assignment-backfill', {
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
      await this.scheduleRepeatableJob();

      this.isInitialized = true;
      logger.info('[ASSIGNMENT-BACKFILL] Queue initialized successfully');
    } catch (error) {
      logger.error('[ASSIGNMENT-BACKFILL] Failed to initialize queue:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private async scheduleRepeatableJob(): Promise<void> {
    if (!this.queue) return;

    // Remove only THIS queue's own repeatable key, not every key on it: wiping them all on
    // each boot means a multi-replica rollout has a window where a tick is dropped or
    // double-registered. Scoped removal still lets a changed cron take effect.
    const repeatableJobs = await this.queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.id === REPEATABLE_JOB_ID) {
        await this.queue.removeRepeatableByKey(job.key);
      }
    }

    await this.queue.add(
      'assignment-backfill',
      { type: 'assignment-backfill' },
      {
        repeat: { cron: EVERY_15_MIN_CRON },
        jobId: REPEATABLE_JOB_ID,
      },
    );
    logger.info('[ASSIGNMENT-BACKFILL] Scheduled repeatable job (every 15 minutes)');
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    this.queue.process('assignment-backfill', async job => {
      logger.info(`[ASSIGNMENT-BACKFILL] Processing job ${job.id}`);
      const restored = await this.reconcileExpiredPauses();
      const enqueued = await this.backfillUnassignedTickets();
      logger.info(
        `[ASSIGNMENT-BACKFILL] Job ${job.id} completed — membersRestored=${restored} ticketsEnqueued=${enqueued}`,
      );
    });
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, error) => {
      logger.error(`[ASSIGNMENT-BACKFILL] Job ${job?.id} failed:`, error);
    });
    this.queue.on('error', error => {
      logger.error('[ASSIGNMENT-BACKFILL] Queue error:', error);
    });
  }

  /**
   * Restore anyone whose "unavailable until" has passed but who is still inactive.
   *
   * The normal restore is a delayed Bull job plus a Redis state backup. If either is lost
   * (eviction, flush, restart) the member stays inactive indefinitely and the whole group
   * can silently fall to zero available. `assignmentUnavailableUntil` lives in Postgres,
   * so it survives all of that and is the durable source of truth for "the pause ended".
   */
  private async reconcileExpiredPauses(): Promise<number> {
    const prisma = DatabaseClient.getInstance();

    try {
      const now = new Date();
      // The pause marker is written to user_presence by this service and to BOTH user and
      // user_presence by the Zero mutator; user_presence is flagged deprecated in the
      // schema but still actively written. Union the two rather than bet on either.
      // Only an EXPIRED marker qualifies — a member an admin deliberately deactivated has
      // no marker, and must not be reactivated by this sweeper.
      const [expiredPresence, expiredUsers] = await Promise.all([
        prisma.userPresence.findMany({
          where: { assignmentUnavailableUntil: { not: null, lte: now } },
          select: { userId: true, assignmentUnavailableUntil: true },
        }),
        prisma.user.findMany({
          where: { assignmentUnavailableUntil: { not: null, lte: now } },
          select: { id: true, assignmentUnavailableUntil: true },
        }),
      ]);

      const expiredAt = new Map<string, Date | null>();
      for (const p of expiredPresence) expiredAt.set(p.userId, p.assignmentUnavailableUntil);
      for (const u of expiredUsers) {
        if (!expiredAt.has(u.id)) expiredAt.set(u.id, u.assignmentUnavailableUntil);
      }
      if (expiredAt.size === 0) return 0;

      // Narrow to members who are actually still inactive somewhere, which is the only
      // case with anything to repair. Bounded in the query rather than sliced afterwards,
      // so the first run after deploy does not read every historical expired marker.
      const stillInactive = await prisma.userAssignmentState.findMany({
        where: { userId: { in: [...expiredAt.keys()] }, isActiveForAssignment: false },
        select: { userId: true },
        distinct: ['userId'],
        take: MAX_PAUSE_RESTORES_PER_RUN,
      });
      if (stillInactive.length === 0) return 0;

      let restored = 0;
      for (const { userId } of stillInactive) {
        const pausedUntil = expiredAt.get(userId) ?? null;

        // One attempt per user per hour. setAvailableForAssignment is a no-op for a member
        // whose backup is gone, and it notifies every group subscriber when it does act —
        // neither should repeat on a 15-minute tick.
        const claimed = await redisService.set(
          `backfill:restore:${userId}`,
          '1',
          DEDUP_TTL_SECONDS,
          true,
        );
        if (!claimed) continue;

        try {
          // Restores the member's prior state from the backup and clears the pause marker.
          // Returns [] when there was nothing to restore and no backup to restore from, in
          // which case the marker is deliberately left intact — count only real repairs.
          const restoredGroups =
            await userAssignmentStateService.setAvailableForAssignment(userId);
          if (restoredGroups.length > 0) {
            restored++;
            logger.info(
              `[ASSIGNMENT-BACKFILL] Restored availability for user ${userId} (pause expired ${pausedUntil?.toISOString()})`,
            );
          } else {
            logger.warn(
              `[ASSIGNMENT-BACKFILL] Could not restore user ${userId} (pause expired ${pausedUntil?.toISOString()}) — no state backup; needs manual review`,
            );
          }
        } catch (error) {
          await redisService.del(`backfill:restore:${userId}`).catch(() => {});
          logger.error(
            `[ASSIGNMENT-BACKFILL] Failed to restore availability for user ${userId}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
      return restored;
    } catch (error) {
      logger.error('[ASSIGNMENT-BACKFILL] Pause reconciliation failed:', error);
      return 0;
    }
  }

  /**
   * Re-run assignment for desk tickets that never got an assignee.
   *
   * Scoped deliberately to tickets that came in through a desk conversation on a channel
   * with an assignee group. Tickets created by hand on a desk board (engineering tickets
   * filed onto a support board, bulk imports) have no conversation and are excluded —
   * auto-assigning those to the support rota would be wrong, not a fix.
   *
   * Reuses the classification worker rather than reimplementing assignment, so activities,
   * workload sync and notifications all behave exactly as they do at ticket creation.
   * `runClassification`/`runPriority` are false: the AI outputs are not what is missing,
   * and skipping them avoids spending LLM quota that live traffic needs.
   */
  private async backfillUnassignedTickets(): Promise<number> {
    const prisma = DatabaseClient.getInstance();

    try {
      const scopedChannels = await prisma.emailChannelPreference.findMany({
        where: { assigneeUserGroupId: { not: null } },
        select: { channelId: true, assigneeUserGroupId: true },
      });
      if (scopedChannels.length === 0) return 0;

      const groupByChannelId = new Map(
        scopedChannels.map(c => [c.channelId, c.assigneeUserGroupId as string]),
      );

      const oldestAllowed = new Date(Date.now() - MAX_TICKET_AGE_DAYS * 24 * 60 * 60 * 1000);

      // boardId/conversationId/channelId are non-nullable on Ticket, so only the rest
      // needs filtering.
      const tickets = await prisma.ticket.findMany({
        where: {
          assignedTo: null,
          channelId: { in: [...groupByChannelId.keys()] },
          isArchived: false,
          statusV2: { notIn: [TicketStatusV2.COMPLETED, TicketStatusV2.CANCELLED] },
          createdAt: { gte: oldestAllowed },
        },
        select: { id: true, channelId: true, conversationId: true, userGroupId: true },
        orderBy: { createdAt: 'asc' },
        take: MAX_TICKETS_PER_RUN,
      });
      if (tickets.length === 0) return 0;

      const conversationIds = tickets.map(t => t.conversationId);

      // The worker needs an emailId; use each conversation's first email, matching what
      // ticket creation passes. `distinct` keeps this to one row per conversation rather
      // than every email across 200 threads.
      const emails = await prisma.email.findMany({
        where: {
          conversationId: { in: conversationIds },
          type: { not: EmailType.COMPOSE },
        },
        select: { id: true, conversationId: true },
        orderBy: [{ conversationId: 'asc' }, { createdAt: 'asc' }],
        distinct: ['conversationId'],
      });
      const firstEmailByConversation = new Map(
        emails.map(email => [email.conversationId, email.id] as const),
      );

      let enqueued = 0;
      let staggerIdx = 0;

      for (const ticket of tickets) {
        // No email for the conversation means this is not a desk-ingested ticket — an
        // engineering ticket or bulk import filed onto a desk board. Those must not be
        // pushed into the support rota, so skipping them here is the intended behaviour,
        // not a gap.
        const emailId = firstEmailByConversation.get(ticket.conversationId);
        if (!emailId) continue;

        // Claim the ticket for an hour before enqueuing. A Bull jobId cannot do this: the
        // classification queue sets removeOnComplete, so the hash disappears as soon as the
        // job finishes and the next 15-minute tick would re-enqueue immediately.
        const claimed = await redisService.set(
          `backfill:assign:${ticket.id}`,
          '1',
          DEDUP_TTL_SECONDS,
          true,
        );
        if (!claimed) continue;

        try {
          await emailClassificationQueue.getQueue().add(
            'classify',
            {
              ticketId: ticket.id,
              channelId: ticket.channelId,
              emailId,
              groupId: ticket.userGroupId ?? groupByChannelId.get(ticket.channelId) ?? null,
              runClassification: false,
              runPriority: false,
              runAssignment: true,
            },
            {
              delay: staggerIdx * STAGGER_MS,
            },
          );
          enqueued++;
          staggerIdx++;
        } catch (error) {
          // Dedup is handled by the Redis claim above, so anything thrown here is real —
          // most plausibly "Queue not initialized" if the classification queue has not come
          // up yet. Release the claim so the next tick retries rather than silently losing
          // the ticket for an hour.
          await redisService.del(`backfill:assign:${ticket.id}`).catch(() => {});
          logger.error(
            `[ASSIGNMENT-BACKFILL] Failed to enqueue assignment for ticket ${ticket.id}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }

      return enqueued;
    } catch (error) {
      logger.error('[ASSIGNMENT-BACKFILL] Ticket backfill failed:', error);
      return 0;
    }
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.isInitialized = false;
      logger.info('[ASSIGNMENT-BACKFILL] Queue closed');
    }
  }
}

export const assignmentBackfillQueue = new AssignmentBackfillQueue();
