/**
 * Consumer for the entity-extraction queue.
 *
 * concurrency 1: a single run already fans out internally (see
 * entityExtraction.concurrency), and two concurrent runs would contend on the
 * same LiteLLM slots — which is what produced an 85% batch failure rate during
 * development in Spaces.
 *
 * lockDuration is 3 hours because a full channel is ~140 LLM calls at 20-75s
 * each. The lock has to outlive the whole run or BullMQ considers the job
 * stalled and hands it to a second worker while the first is still going.
 */

import { Worker, type Job } from "bullmq";
import { errMsg } from "../lib/errors.js";
import { redisService } from "../redis.js";
import { prisma } from "../db.js";
import { createLogger, createTraceId } from "../logger.js";
import { discoverTypes } from "../services/entityExtraction/entityExtractionService.js";
import {
  ENTITY_EXTRACTION_QUEUE_NAME,
  type EntityExtractionJobData,
} from "./entity-extraction-queue.js";

const logger = createLogger("entity-extraction-worker", createTraceId());

const LOCK_DURATION_MS = 3 * 60 * 60 * 1000;

let worker: Worker<EntityExtractionJobData> | undefined;

export function initEntityExtractionWorker(): Worker<EntityExtractionJobData> {
  worker = new Worker<EntityExtractionJobData>(
    ENTITY_EXTRACTION_QUEUE_NAME,
    async (job: Job<EntityExtractionJobData>) => {
      const { runId, channelId } = job.data;
      const startedAt = Date.now();
      logger.info("[entity-extraction] discovering types", { runId, channelId, jobId: job.id });

      await discoverTypes(runId);

      logger.info("[entity-extraction] type discovery finished", {
        runId,
        channelId,
        jobId: job.id,
        seconds: Math.round((Date.now() - startedAt) / 1000),
      });
    },
    {
      connection: redisService.getConnection(),
      concurrency: 1,
      lockDuration: LOCK_DURATION_MS,
      stalledInterval: 60_000,
      maxStalledCount: 1,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error("[entity-extraction] job failed", {
      jobId: job?.id,
      runId: job?.data?.runId,
      attemptsMade: job?.attemptsMade,
      err: errMsg(err),
    });
    void markFailed(job?.data?.runId, err, job?.attemptsMade ?? 0, job?.opts?.attempts);
  });

  return worker;
}

/**
 * Only mark the run FAILED once BullMQ has exhausted its retries — an
 * intermediate failure will be retried and should not surface to the user as a
 * dead run.
 */
async function markFailed(
  runId: string | undefined,
  err: unknown,
  attemptsMade: number,
  maxAttempts?: number,
): Promise<void> {
  if (!runId) return;
  if (maxAttempts && attemptsMade < maxAttempts) return;

  try {
    await prisma.entityExtractionRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        errorMessage: String(err instanceof Error ? err.message : err).slice(0, 1000),
        completedAt: new Date(),
      },
    });
  } catch (updateErr) {
    logger.error("[entity-extraction] could not mark run failed", {
      runId,
      err: errMsg(updateErr),
    });
  }
}

export async function closeEntityExtractionWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
}
