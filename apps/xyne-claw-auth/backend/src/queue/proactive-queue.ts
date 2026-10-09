import { Queue } from "bullmq";
import { redisService } from "../redis.js";
import { PROACTIVE } from "../proactive/config.js";

export interface InboxIngestJobData {
  sourceId: string;
}

export const INGEST_QUEUE_NAME = "proactive-inbox-ingest";
export const TICK_QUEUE_NAME = "proactive-inbox-tick";
export const TICK_SCHEDULER_ID = "proactive-inbox-tick";

let ingestQueue: Queue<InboxIngestJobData> | undefined;
let tickQueue: Queue | undefined;

export function getIngestQueue(): Queue<InboxIngestJobData> {
  if (!ingestQueue) {
    ingestQueue = new Queue<InboxIngestJobData>(INGEST_QUEUE_NAME, {
      connection: redisService.getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
  }
  return ingestQueue;
}

export function getProactiveTickQueue(): Queue {
  if (!tickQueue) {
    tickQueue = new Queue(TICK_QUEUE_NAME, {
      connection: redisService.getConnection(),
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    });
  }
  return tickQueue;
}

export async function enqueueInboxIngest(
  sourceId: string,
  delayMs: number = PROACTIVE.ingestDebounceMs,
  suffix?: string,
): Promise<void> {
  const jobId = suffix ? `inbox-ingest-${sourceId}-${suffix}` : `inbox-ingest-${sourceId}`;
  await getIngestQueue().add("ingest", { sourceId }, { jobId, delay: delayMs });
}

export async function ensureProactiveTickScheduler(): Promise<void> {
  await getProactiveTickQueue().upsertJobScheduler(
    TICK_SCHEDULER_ID,
    { every: PROACTIVE.tickMs },
    { name: "proactive-tick", data: {} },
  );
}

export async function removeProactiveTickScheduler(): Promise<void> {
  await getProactiveTickQueue().removeJobScheduler(TICK_SCHEDULER_ID).catch(() => false);
}

export async function closeProactiveQueues(): Promise<void> {
  await ingestQueue?.close().catch(() => {});
  await tickQueue?.close().catch(() => {});
  ingestQueue = undefined;
  tickQueue = undefined;
}
