import Bull from 'bull';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { scopeKeyFor } from '@/services/radar/radarScope';
import { ChannelScopeType } from '@xyne/shared';

export interface RadarExecutionJobData {
  conversationId: string;
  channelId: string;
  /** ChannelScopeType of the conversation's channel; decides the scope key. */
  scopeType: string | null;
}

/** Per-scope quiet period before a window is parsed: how fast Radar reacts, and
 *  how many messages one parse covers. A DM waits longer — its gate lets every
 *  message through, so this is what bounds the parse rate there. */
const DEBOUNCE_MS = config.radar.debounceMs;
const DM_DEBOUNCE_MS = config.radar.dmDebounceMs;

export function isRadarExecutionEnabled(): boolean {
  return config.radar.enabled;
}

class RadarExecutionQueue {
  private queue: Bull.Queue<RadarExecutionJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<RadarExecutionJobData>('radar-execution', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          // Deviates from the repo's removeOnFail:false convention on purpose:
          // jobId is a stable, reused scope key, so a retained failed job
          // would silently block that scope's enqueues forever (Bull ignores
          // adds whose jobId exists in any state). Failures are logged by the
          // 'failed' listener below instead.
          removeOnFail: true,
        },
        settings: {
          lockDuration: 2 * 60 * 1000,
          stalledInterval: 60 * 1000,
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[RADAR-EXECUTION-QUEUE] Initialized');
    } catch (error) {
      logger.error('[RADAR-EXECUTION-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Enqueue a "something happened here" signal. Fire-and-forget by contract:
   * never throws, so the chat write path can never be blocked.
   *
   * jobId = scope key + delay gives per-scope debounce: while a job for this
   * scope is delayed/waiting/active, further adds are no-ops, and the worker
   * reads everything above the scope's watermark when the job runs.
   *
   * The scope key is what makes the debounce work in a DM at all. Keyed by
   * conversation, every DM message is its own job — ten fast replies are ten
   * parses of one message each. Keyed by channel, they coalesce into one.
   */
  async enqueueThread(data: RadarExecutionJobData): Promise<void> {
    if (!isRadarExecutionEnabled()) return;

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }
      if (!this.queue) return;

      const jobId = scopeKeyFor(data.scopeType, data.channelId, data.conversationId);
      await this.queue.add(data, {
        jobId,
        delay: data.scopeType === ChannelScopeType.DM ? DM_DEBOUNCE_MS : DEBOUNCE_MS,
      });
    } catch (error) {
      logger.error('[RADAR-EXECUTION-QUEUE] Failed to enqueue thread:', {
        conversationId: data.conversationId,
        error,
      });
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[RADAR-EXECUTION-QUEUE] Job ${job.id} failed — conversation ${job.data.conversationId}:`,
        err,
      );
    });

    this.queue.on('stalled', job => {
      logger.warn(`[RADAR-EXECUTION-QUEUE] Job ${job.id} stalled — conversation ${job.data.conversationId}`);
    });

    this.queue.on('error', err => {
      logger.error('[RADAR-EXECUTION-QUEUE] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<RadarExecutionJobData> {
    if (!this.queue) {
      throw new Error('[RADAR-EXECUTION-QUEUE] Queue not initialized — call initialize() first');
    }
    return this.queue;
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[RADAR-EXECUTION-QUEUE] Closed');
    }
  }
}

export const radarExecutionQueue = new RadarExecutionQueue();
