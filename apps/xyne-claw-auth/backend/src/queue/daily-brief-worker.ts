import { Worker, type Job } from "bullmq";
import { errMsg } from "../lib/errors.js";
import { redisService } from "../redis.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { generateDailyBrief } from "../services/dailyBrief.js";
import { withDailyBriefLlmSlot } from "../lib/daily-brief-slot.js";
import { prisma } from "../db.js";
import { DAILY_BRIEF_QUEUE_NAME, type DailyBriefJobData } from "./daily-brief-queue.js";

const log = createLogger("daily-brief-worker");

let worker: Worker<DailyBriefJobData> | undefined;

async function processJob(job: Job<DailyBriefJobData>): Promise<void> {
  const { userId } = job.data;
  // Defensive re-check: the user may have toggled the brief off between enqueue
  // and processing. A per-user boolean gate (no Redis scheduler to tear down).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailyBriefEnabled: true },
  });
  if (!user?.dailyBriefEnabled) {
    log.info(`[daily-brief-worker] ${userId} no longer enabled — skipping`);
    return;
  }
  // AWAITS the run to completion, holding one CLUSTER-GLOBAL slot (Redis
  // semaphore) for the duration. Per-worker `concurrency` bounds per-pod pulls;
  // the global slot is what actually caps concurrent LLM runs across ALL replicas
  // (BullMQ concurrency/limiter are per-instance) — the real provider-rate guard
  // for a mass fan-out. If no slot frees within the wait window the gate throws
  // and BullMQ retries the job later.
  await withDailyBriefLlmSlot(() => generateDailyBrief(userId, { trigger: "scheduled" }));
}

/**
 * Register the daily-brief worker. `concurrency` bounds how many jobs THIS pod
 * pulls at once; the cluster-wide LLM concurrency cap is enforced separately by
 * the Redis slot gate (CONFIG.dailyBriefGlobalConcurrency) so it holds regardless
 * of replica count. The optional per-worker `limiter` additionally caps the local
 * START rate. All env-tunable.
 */
export function initDailyBriefWorker(): Worker<DailyBriefJobData> {
  const concurrency = CONFIG.dailyBriefConcurrency;
  worker = new Worker<DailyBriefJobData>(DAILY_BRIEF_QUEUE_NAME, processJob, {
    connection: redisService.getConnection(),
    concurrency,
    ...(CONFIG.dailyBriefRateMax > 0
      ? { limiter: { max: CONFIG.dailyBriefRateMax, duration: CONFIG.dailyBriefRateDurationMs } }
      : {}),
  });
  worker.on("failed", (job, err) => {
    log.error(`[daily-brief-worker] job ${job?.id} failed: ${errMsg(err)}`);
  });
  worker.on("error", (err) => {
    log.error(`[daily-brief-worker] worker error: ${errMsg(err)}`);
  });
  log.info(`[daily-brief-worker] started (concurrency=${concurrency}, rateMax=${CONFIG.dailyBriefRateMax}/${CONFIG.dailyBriefRateDurationMs}ms)`);
  return worker;
}

export async function closeDailyBriefWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
}
