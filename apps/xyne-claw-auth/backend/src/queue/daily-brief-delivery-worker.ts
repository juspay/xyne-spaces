import { Worker, type Job } from "bullmq";
import { errMsg } from "../lib/errors.js";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";
import { deliverDailyBriefToWhatsapp } from "../services/dailyBriefWhatsapp.js";
import { DAILY_BRIEF_DELIVERY_QUEUE_NAME, type DailyBriefDeliveryJobData } from "./daily-brief-delivery-queue.js";

const log = createLogger("daily-brief-delivery-worker");

let worker: Worker<DailyBriefDeliveryJobData> | undefined;

async function processJob(job: Job<DailyBriefDeliveryJobData>): Promise<void> {
  const { userId, dateBucket } = job.data;
  const result = await deliverDailyBriefToWhatsapp(userId, dateBucket);
  // Throwing hands the job back to BullMQ's backoff; only a transient send
  // failure is worth another attempt.
  if (result.retry) throw new Error(`daily brief WhatsApp send failed (${result.outcome})`);
}

/** Sends are cheap (no LLM), so a small fixed concurrency is enough. */
export function initDailyBriefDeliveryWorker(): Worker<DailyBriefDeliveryJobData> {
  worker = new Worker<DailyBriefDeliveryJobData>(DAILY_BRIEF_DELIVERY_QUEUE_NAME, processJob, {
    connection: redisService.getConnection(),
    concurrency: 4,
  });
  worker.on("failed", (job, err) => {
    log.warn(`[daily-brief-delivery-worker] job ${job?.id} failed (attempt ${job?.attemptsMade}): ${errMsg(err)}`);
  });
  worker.on("error", (err) => {
    log.error(`[daily-brief-delivery-worker] worker error: ${errMsg(err)}`);
  });
  log.info("[daily-brief-delivery-worker] started (concurrency=4)");
  return worker;
}

export async function closeDailyBriefDeliveryWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
}
