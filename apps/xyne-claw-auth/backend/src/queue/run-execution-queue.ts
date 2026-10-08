import { Queue } from "bullmq";
import { CONFIG } from "../config.js";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";

const log = createLogger("run-execution-queue");

export type RunExecutionJobData = Record<string, unknown> & { sessionId: string };

const QUEUE_NAME = "run-execution";

function maxAttempts(): number {
  const parsed = CONFIG.runQueueMaxAttempts;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 4;
}

let queue: Queue<RunExecutionJobData> | undefined;

export function getRunExecutionQueue(): Queue<RunExecutionJobData> {
  if (!queue) {
    const connection = redisService.getConnection();
    const opts = (connection as { options?: { host?: string; port?: number } }).options;
    log.info(`[run-queue] queue bound queue=${QUEUE_NAME} redis=${opts?.host ?? "?"}:${opts?.port ?? "?"}`);
    queue = new Queue<RunExecutionJobData>(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: maxAttempts(),
        backoff: { type: "exponential", delay: 15_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      },
    });
  }
  return queue;
}

export async function enqueueRun(payload: RunExecutionJobData): Promise<void> {
  const q = getRunExecutionQueue();
  const existing = await q.getJob(payload.sessionId);
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      await existing.remove();
    }
  }
  await q.add(payload.sessionId, payload, { jobId: payload.sessionId });
}

export const RUN_EXECUTION_QUEUE_NAME = QUEUE_NAME;

export async function closeRunExecutionQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
