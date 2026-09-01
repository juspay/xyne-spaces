import { Queue } from "bullmq";
import { CONFIG } from "../config.js";
import { redisService } from "../redis.js";

export type RunExecutionJobData = Record<string, unknown> & { sessionId: string };

const QUEUE_NAME = "run-execution";

function maxAttempts(): number {
  const parsed = CONFIG.runQueueMaxAttempts;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 4;
}

let queue: Queue<RunExecutionJobData> | undefined;

export function getRunExecutionQueue(): Queue<RunExecutionJobData> {
  if (!queue) {
    queue = new Queue<RunExecutionJobData>(QUEUE_NAME, {
      connection: redisService.getConnection(),
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
  await getRunExecutionQueue().add(payload.sessionId, payload, { jobId: payload.sessionId });
}

export const RUN_EXECUTION_QUEUE_NAME = QUEUE_NAME;

export async function closeRunExecutionQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
