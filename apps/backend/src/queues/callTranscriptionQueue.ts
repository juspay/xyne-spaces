import Bull from 'bull';
import { logger } from '@/utils/logger';

export interface CallTranscriptionJobData {
  /** Call email id (the Ozonetel call message in the ticket thread). */
  emailId: string;
  workspaceId: string;
  /** User who clicked "Transcribe"; becomes the attachment's uploader. */
  userId: string;
}

export const CALL_TRANSCRIPTION_JOB = 'transcribe';
const QUEUE_NAME = 'call-transcription';
const TAG = '[CALL-TRANSCRIPTION]';

/** Whole-job timeout: the agent call is capped at 32 min, leave headroom for the attachment upload. */
const JOB_TIMEOUT_MS = 35 * 60_000;

export function callTranscriptionJobId(emailId: string): string {
  return `call-transcript-${emailId}`;
}

/**
 * Transcribes an Ozonetel call recording into a transcript attachment on the
 * call email. Manual trigger only (the "Transcribe" button).
 *
 * The audio download and STT both happen in the Python agent; the job here
 * only holds an HTTP call to the agent open and then writes the attachment, so
 * the consumer runs in the API process (`startConsumer()` from app.ts) like the
 * other lightweight queues. One job per call email (jobId = emailId) so a double
 * click or a concurrent request never starts a second transcription. Whole-job
 * failures retry with backoff; permanent failures (recording gone, bad media)
 * are reported by the processor returning normally so Bull does not burn
 * retries on them.
 */
class CallTranscriptionQueue {
  private queue: Bull.Queue<CallTranscriptionJobData> | null = null;
  private consuming = false;

  private ensureQueue(): Bull.Queue<CallTranscriptionJobData> {
    if (this.queue) return this.queue;

    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      maxRetriesPerRequest: 3,
      ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
      ...(process.env.REDIS_TLS === 'true' && {
        tls: {
          rejectUnauthorized: false,
        },
      }),
    };

    this.queue = new Bull<CallTranscriptionJobData>(QUEUE_NAME, {
      redis: redisConfig,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 30_000,
        },
        timeout: JOB_TIMEOUT_MS,
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
    this.queue.on('error', (error) => {
      logger.error(`${TAG} Queue error:`, error);
    });
    return this.queue;
  }

  /**
   * True when a job for this email is currently waiting, delayed, or running.
   * Used by the API to answer 409 without touching the email body.
   */
  async isInProgress(emailId: string): Promise<boolean> {
    const job = await this.ensureQueue().getJob(callTranscriptionJobId(emailId));
    if (!job) return false;
    const state = await job.getState();
    return state === 'waiting' || state === 'active' || state === 'delayed' || state === 'paused';
  }

  /**
   * Producer side (API): enqueue a transcription job.
   * A leftover completed/failed job with the same id is removed first so a
   * retry after failure is possible (Bull refuses duplicate ids otherwise).
   * Returns false if a job is already in progress.
   */
  async enqueue(data: CallTranscriptionJobData): Promise<boolean> {
    const queue = this.ensureQueue();
    const jobId = callTranscriptionJobId(data.emailId);

    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed' || state === 'paused') {
        return false;
      }
      await existing.remove();
    }

    await queue.add(CALL_TRANSCRIPTION_JOB, data, { jobId });
    logger.info(`${TAG} enqueued | emailId=${data.emailId} | workspaceId=${data.workspaceId}`);
    return true;
  }

  /** Register the processor (called once from app.ts). Idempotent per process. */
  startConsumer(concurrency = 1): void {
    if (this.consuming) return;
    this.consuming = true;
    const queue = this.ensureQueue();
    queue.process(CALL_TRANSCRIPTION_JOB, concurrency, async (job) => {
      // Lazy import keeps the producer (API) free of the service's dependencies.
      const { callTranscriptionService } = await import('@/services/ozonetel/callTranscriptionService');
      return callTranscriptionService.process(job.data, job.attemptsMade + 1, job.opts.attempts ?? 1);
    });
    queue.on('failed', async (job, error) => {
      logger.error(`${TAG} Job for email ${job.data?.emailId} failed (attempt ${job.attemptsMade}):`, error);
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= attempts && job.data) {
        // Final attempt exhausted: surface it in the thread so the user can retry.
        try {
          const { callTranscriptionService } = await import('@/services/ozonetel/callTranscriptionService');
          await callTranscriptionService.markFailed(job.data, error instanceof Error ? error.message : String(error));
        } catch (markError) {
          logger.error(`${TAG} Failed to record failure state for email ${job.data.emailId}:`, markError);
        }
      }
    });
    logger.info(`${TAG} Consumer started (concurrency=${concurrency})`);
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.consuming = false;
      logger.info(`${TAG} Queue closed`);
    }
  }
}

export const callTranscriptionQueue = new CallTranscriptionQueue();
