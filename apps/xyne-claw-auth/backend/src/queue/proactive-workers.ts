import { Worker, type Job } from "bullmq";
import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";
import { redisService } from "../redis.js";
import { PROACTIVE, proactiveMode } from "../proactive/config.js";
import { ingestGmailSource } from "../proactive/ingest.js";
import { runProactiveTick } from "../proactive/sweep.js";
import {
  INGEST_QUEUE_NAME,
  TICK_QUEUE_NAME,
  ensureProactiveTickScheduler,
  removeProactiveTickScheduler,
  type InboxIngestJobData,
} from "./proactive-queue.js";

const log = createLogger("proactive-workers");

let ingestWorker: Worker<InboxIngestJobData> | undefined;
let tickWorker: Worker | undefined;

export function initProactiveWorkers(): void {
  if (proactiveMode() === "off") {
    void removeProactiveTickScheduler();
    return;
  }
  ingestWorker = new Worker<InboxIngestJobData>(
    INGEST_QUEUE_NAME,
    async (job: Job<InboxIngestJobData>) => ingestGmailSource(job.data.sourceId),
    { connection: redisService.getConnection(), concurrency: PROACTIVE.ingestConcurrency },
  );
  ingestWorker.on("failed", (job, err) => log.warn(`[proactive] ingest ${job?.id} failed: ${errMsg(err)}`));
  ingestWorker.on("error", (err) => log.error(`[proactive] ingest worker error: ${errMsg(err)}`));

  tickWorker = new Worker(TICK_QUEUE_NAME, async () => runProactiveTick(), {
    connection: redisService.getConnection(),
    concurrency: 1,
  });
  tickWorker.on("failed", (job, err) => log.warn(`[proactive] tick ${job?.id} failed: ${errMsg(err)}`));
  tickWorker.on("error", (err) => log.error(`[proactive] tick worker error: ${errMsg(err)}`));

  void ensureProactiveTickScheduler().catch((err) => log.error(`[proactive] tick scheduler registration failed: ${errMsg(err)}`));
  log.info(`[proactive] workers started mode=${proactiveMode()} tick=${PROACTIVE.tickMs}ms`);
}

export async function closeProactiveWorkers(): Promise<void> {
  await ingestWorker?.close().catch(() => {});
  await tickWorker?.close().catch(() => {});
  ingestWorker = undefined;
  tickWorker = undefined;
}
