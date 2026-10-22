import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { TranscriptionAgentError, describeTranscriptionAgentError } from '@/services/transcriptionAgentClient';

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

/** Whole-job timeout: must stay above the agent HTTP call (45 min) with headroom for the
 * attachment upload and summary that run after the agent returns. */
const JOB_TIMEOUT_MS = 50 * 60_000;

export function callTranscriptionJobId(emailId: string): string {
  return `call-transcript-${emailId}`;
}

/**
 * Transcribes an Ozonetel call recording into a transcript attachment on the
 * call email. Manual trigger only (the "Transcribe" button).
 *
 * The audio download and STT both happen in the Python agent; the job here
 * only holds an HTTP call to the agent open and then writes the attachment, so
 * the consumer runs in the worker process (`startConsumer()` from worker.ts, gated by
 * ENABLE_CALL_TRANSCRIPTION_WORKER); the API only enqueues. One job per call email (jobId = emailId) so a double
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

    this.queue = new Bull<CallTranscriptionJobData>(QUEUE_NAME, {
      redis: { ...redisService.getRedisConfig(), lazyConnect: false },
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
      // A job can hold for ~45 min, so a rolling
      // deploy can stall the same job more than once. Bull's default of 1 would fail it.
      settings: { maxStalledCount: 3 },
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

  /** Register the processor (called once from worker.ts). Idempotent per process. */
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
      if (!job?.data) return;
      logger.error(`${TAG} Job for email ${job.data.emailId} failed (attempt ${job.attemptsMade}):`, error);
      try {
        // Finally failed = attempts exhausted OR stalled past maxStalledCount (which never bumps
        // attemptsMade). An attempt with retries left sits in `delayed`, not `failed`.
        if (await job.isFailed()) {
          const { callTranscriptionService } = await import('@/services/ozonetel/callTranscriptionService');
          // Keep the user-facing message friendly; never surface raw errors (internal IPs/ports).
          const message = error instanceof TranscriptionAgentError
            ? describeTranscriptionAgentError(error)
            : 'Transcription failed. Please try again.';
          await callTranscriptionService.markFailed(job.data, message);
        }
      } catch (markError) {
        logger.error(`${TAG} Failed to record failure state for email ${job.data.emailId}:`, markError);
      }
    });
    logger.info(`${TAG} Consumer started (concurrency=${concurrency})`);
  }

  async close(): Promise<void> {
    if (this.queue) {
      // doNotWaitJobs: a running job can take ~45 min; it stalls and another pod picks it up.
      await this.queue.close(true);
      this.queue = null;
      this.consuming = false;
      logger.info(`${TAG} Queue closed`);
    }
  }
}

export const callTranscriptionQueue = new CallTranscriptionQueue();
