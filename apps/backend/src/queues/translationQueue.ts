import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { config } from '@/config/env';
import { detectMessageLanguage, translateMessageOnDemand } from '@/services/translation/translateMessage';

const QUEUE_NAME = 'message-translation';
const DETECT_JOB_NAME = 'detect-language';
const TRANSLATE_JOB_NAME = 'translate-on-demand';

/**
 * This is enqueued from inside the Zero transaction that inserts the message (see
 * messages-handler.ts), so the row may not be committed to Postgres yet when Bull
 * dispatches to an idle worker — a bare `enqueue()` with no delay raced ahead of the
 * commit often enough in practice to matter. A short delay is cheap here: detection
 * is already off the sender's path, so this adds no perceptible latency for anyone.
 */
const ENQUEUE_DELAY_MS = 1500;

export type DetectLanguageJob = { messageId: string };
export type TranslateOnDemandJob = { messageId: string; targetLang: string };

/**
 * Slack-model translation queue: two job kinds sharing one queue.
 *
 *  - `detect-language` — cheap (franc only, no model), fired for every message off
 *    the send path so the client knows whether to even show a "Translate" toggle.
 *  - `translate-on-demand` — the only place LibreTranslate actually runs, fired once
 *    per (message, targetLang) the first time a viewer clicks Translate. No enqueue
 *    delay: by the time a message is clickable in the UI it's already committed.
 */
class MessageTranslationQueue {
  private queue: Bull.Queue<DetectLanguageJob | TranslateOnDemandJob> | null = null;
  private isInitialized = false;
  private processorRegistered = false;

  /** Call once at startup, in both the API (producer) and worker (consumer) processes. */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (!config.messageTranslationEnabled) {
      logger.info('[MessageTranslationQueue] Disabled; not initializing');
      return;
    }
    try {
      this.queue = new Bull(QUEUE_NAME, {
        redis: { ...redisService.getRedisConfig(), lazyConnect: false },
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      });
      this.queue.on('error', err => logger.error('[MessageTranslationQueue] error:', err));
      this.isInitialized = true;
      logger.info('[MessageTranslationQueue] Initialized');
    } catch (err) {
      logger.error('[MessageTranslationQueue] Failed to initialize:', err);
    }
  }

  getQueue(): Bull.Queue<DetectLanguageJob | TranslateOnDemandJob> | null {
    return this.queue;
  }

  /**
   * Register both workers. Call after initialize().
   *
   * Detection gets real concurrency — it's franc only, CPU-cheap, no shared model
   * state. Translation stays at 1: the local LibreTranslate instance is itself
   * configured single-threaded (`--threads 1` in docker-compose.local.yml, to keep its
   * memory footprint down — see libreTranslator.ts), so extra concurrency here would
   * only queue requests behind each other on LibreTranslate's side, not parallelize.
   */
  startProcessing(detectionConcurrency = 4, translationConcurrency = 1): void {
    if (!this.queue || this.processorRegistered) return;
    this.processorRegistered = true;

    void this.queue.process(DETECT_JOB_NAME, detectionConcurrency, async job => {
      const { messageId } = job.data as DetectLanguageJob;
      try {
        const result = await detectMessageLanguage(messageId);
        logger.info('[MessageTranslationQueue] Detected language', { messageId, ...result });
        return result;
      } catch (error) {
        logger.error('[MessageTranslationQueue] Detection failed', { messageId, error });
        throw error;
      }
    });

    void this.queue.process(TRANSLATE_JOB_NAME, translationConcurrency, async job => {
      const { messageId, targetLang } = job.data as TranslateOnDemandJob;
      try {
        const result = await translateMessageOnDemand(messageId, targetLang);
        logger.info('[MessageTranslationQueue] Translated message', {
          messageId,
          targetLang,
          ...result,
        });
        return result;
      } catch (error) {
        logger.error('[MessageTranslationQueue] Translation failed', {
          messageId,
          targetLang,
          error,
        });
        throw error;
      }
    });

    logger.info('[MessageTranslationQueue] Processors registered', {
      detectionConcurrency,
      translationConcurrency,
    });
  }

  async shutdown(): Promise<void> {
    if (!this.queue) return;
    await this.queue.close();
    this.queue = null;
    this.isInitialized = false;
    this.processorRegistered = false;
    logger.info('[MessageTranslationQueue] Shut down');
  }

  /**
   * Consider a message for language detection. Guarded internally so callers can
   * fire-and-forget.
   *
   * Deliberately does NO database read here — this runs inside the Zero transaction
   * that created the message, so a brand-new message may not be visible to Prisma yet.
   * All real work happens in the consumer, which runs after commit.
   */
  async enqueueDetection(messageId: string): Promise<void> {
    if (!messageId) return;
    if (!this.queue) {
      logger.warn('[MessageTranslationQueue] Not initialized; nothing will be detected');
      return;
    }

    const jobId = `detect:${messageId}`;
    try {
      await this.queue.add(
        DETECT_JOB_NAME,
        { messageId },
        { jobId, delay: ENQUEUE_DELAY_MS },
      );
    } catch (error) {
      logger.error('[MessageTranslationQueue] Failed to enqueue detection', { messageId, error });
    }
  }

  /**
   * A viewer clicked "Translate" on a message. No delay: the message is already
   * fully committed by the time it's clickable, so there's no race to guard against
   * here the way there is for enqueueDetection.
   */
  async enqueueOnDemandTranslation(messageId: string, targetLang: string): Promise<void> {
    if (!messageId || !targetLang) return;
    if (!this.queue) {
      logger.warn('[MessageTranslationQueue] Not initialized; nothing will be translated');
      return;
    }

    const jobId = `translate:${messageId}:${targetLang}`;
    try {
      await this.queue.add(TRANSLATE_JOB_NAME, { messageId, targetLang }, { jobId });
    } catch (error) {
      logger.error('[MessageTranslationQueue] Failed to enqueue translation', {
        messageId,
        targetLang,
        error,
      });
    }
  }
}

export const messageTranslationQueue = new MessageTranslationQueue();
