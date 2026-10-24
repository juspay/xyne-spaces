import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { config } from '@/config/env';

// Wait for the thread to go quiet this long, so a burst of replies and notes is one LLM
// call. Every new event pushes the window back; `immediate` enqueues skip it.
const DEBOUNCE_MS = Number(process.env['TICKET_THREAD_SUMMARY_DEBOUNCE_MS'] ?? 5_000);

const QUEUE_NAME = 'ticket-thread-summary';
const JOB_NAME = 'summarize-ticket-thread';

// Set when an event arrives while the ticket's summary is already running; the finishing
// job turns it into one follow-up run. The TTL only bounds a marker whose job never ends.
const followUpKey = (ticketId: string): string => `ticket:thread-summary:follow-up:${ticketId}`;
const FOLLOW_UP_TTL_SECONDS = 60 * 60;

// `backfill` summarises a historical ticket without running related-ticket detection for it.
export type TicketThreadSummaryJob = { ticketId: string; backfill?: boolean };

const jobIdFor = (ticketId: string): string => `thread-summary:${ticketId}`;
// A finishing job's id stays taken until it completes, so its follow-up needs the other id.
const followUpJobIdFor = (ticketId: string): string => `${jobIdFor(ticketId)}:next`;

/**
 * Off-request desk ticket thread summaries (see ticketThreadSummaryService). Failures are
 * retried twice then dropped — the next reply, note or open of the ticket queues it again.
 * Customer emails on an existing ticket queue nothing; the open-if-stale check covers them.
 */
class TicketThreadSummaryQueue {
  private queue: Bull.Queue<TicketThreadSummaryJob> | null = null;
  private isInitialized = false;
  private processorRegistered = false;

  /**
   * Call once at startup in both the API (producer) and worker (consumer) processes.
   * A no-op when the feature is off, so the producer never fills a queue nobody drains.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (!config.ticketThreadSummaryEnabled) {
      logger.info('[TicketThreadSummaryQueue] Disabled; not initializing');
      return;
    }
    try {
      this.queue = new Bull<TicketThreadSummaryJob>(QUEUE_NAME, {
        redis: { ...redisService.getRedisConfig(), lazyConnect: false },
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      });
      this.queue.on('error', err => logger.error('[TicketThreadSummaryQueue] error:', err));
      this.isInitialized = true;
      logger.info('[TicketThreadSummaryQueue] Initialized');
    } catch (err) {
      logger.error('[TicketThreadSummaryQueue] Failed to initialize:', err);
    }
  }

  getQueue(): Bull.Queue<TicketThreadSummaryJob> | null {
    return this.queue;
  }

  /** Register the worker. Call after initialize(). */
  startProcessing(concurrency = 2): void {
    if (!this.queue || this.processorRegistered) return;
    this.processorRegistered = true;

    void this.queue.process(JOB_NAME, concurrency, async job => {
      const { ticketId, backfill } = job.data;
      // Imported lazily: the service pulls in the duplicate service and Vespa client,
      // which the producer side (API process) never needs from here.
      const { refreshTicketThreadSummary } = await import('@/services/ticketThreadSummaryService');
      try {
        await refreshTicketThreadSummary(ticketId, { detectRelated: !backfill });
      } catch (error) {
        logger.error('[TicketThreadSummaryQueue] Summary failed', { ticketId, error });
        throw error;
      }
      await this.queueFollowUp(ticketId, String(job.id) === jobIdFor(ticketId) ? followUpJobIdFor(ticketId) : jobIdFor(ticketId));
    });

    logger.info('[TicketThreadSummaryQueue] Processor registered', { concurrency });
  }

  async shutdown(): Promise<void> {
    if (!this.queue) return;
    await this.queue.close();
    this.queue = null;
    this.isInitialized = false;
    this.processorRegistered = false;
    logger.info('[TicketThreadSummaryQueue] Shut down');
  }

  /**
   * Queue a summary refresh. Fire-and-forget safe, no database read; the consumer re-checks
   * the ticket. A waiting job is replaced to push the quiet window back (Bull ignores an add
   * whose jobId exists); an event during a run becomes one follow-up run (queueFollowUp).
   */
  async enqueue(ticketId: string, { immediate = false }: { immediate?: boolean } = {}): Promise<void> {
    if (!ticketId || !this.queue) return;

    try {
      for (const jobId of [jobIdFor(ticketId), followUpJobIdFor(ticketId)]) {
        const existing = await this.queue.getJob(jobId);
        if (!existing) continue;
        if ((await existing.getState()) === 'active') {
          await redisService.set(followUpKey(ticketId), '1', FOLLOW_UP_TTL_SECONDS);
          return;
        }
        await existing.remove();
      }
      await this.queue.add(
        JOB_NAME,
        { ticketId },
        { jobId: jobIdFor(ticketId), ...(immediate ? {} : { delay: DEBOUNCE_MS }) },
      );
    } catch (error) {
      logger.error('[TicketThreadSummaryQueue] Failed to enqueue', { ticketId, error });
    }
  }

  /** After a run: one more run, after the window, if anything arrived while it ran. */
  private async queueFollowUp(ticketId: string, jobId: string): Promise<void> {
    if (!this.queue) return;
    try {
      if (!(await redisService.get(followUpKey(ticketId)))) return;
      await redisService.del(followUpKey(ticketId));
      await this.queue.add(JOB_NAME, { ticketId }, { jobId, delay: DEBOUNCE_MS });
    } catch (error) {
      logger.error('[TicketThreadSummaryQueue] Follow-up enqueue failed', { ticketId, error });
    }
  }

  /**
   * Backfill enqueue for a ticket created before summaries existed. Skipped (false) when a
   * job for the ticket is already pending, so a live refresh is never replaced by one that
   * would skip related-ticket detection.
   */
  async enqueueBackfill(ticketId: string, delayMs = 0): Promise<boolean> {
    if (!ticketId || !this.queue) return false;
    const jobId = jobIdFor(ticketId);
    try {
      if (await this.queue.getJob(jobId)) return false;
      await this.queue.add(
        JOB_NAME,
        { ticketId, backfill: true },
        { jobId, ...(delayMs > 0 ? { delay: delayMs } : {}) },
      );
      return true;
    } catch (error) {
      logger.error('[TicketThreadSummaryQueue] Backfill enqueue failed', { ticketId, error });
      return false;
    }
  }
}

export const ticketThreadSummaryQueue = new TicketThreadSummaryQueue();
