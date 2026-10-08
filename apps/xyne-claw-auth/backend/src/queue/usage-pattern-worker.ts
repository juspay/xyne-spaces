/**
 * Worker for the usage-pattern queue. One job is one agent's synthesis pass,
 * awaited to completion while holding a cluster-global LLM slot.
 *
 * Two caps, because they answer different questions. `concurrency` bounds how
 * many jobs THIS pod pulls; the Redis slot gate bounds how many passes the
 * whole fleet has in flight, which is the one that matters when every replica
 * runs a copy of this worker and the fan-out is the entire active roster.
 */

import { Worker, type Job } from "bullmq";
import { errMsg } from "../lib/errors.js";
import { redisService } from "../redis.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { prisma } from "../db.js";
import { withGlobalLlmSlot } from "../lib/llm-slot.js";
import { synthesizeUsagePatterns, usagePatternJob } from "../services/usage-patterns/index.js";
import { USAGE_PATTERN_QUEUE_NAME, type UsagePatternJobData } from "./usage-pattern-queue.js";

const log = createLogger("usage-pattern-worker");

const SLOT_KEY = "claw:usage-patterns:llm-slots";
/**
 * Must exceed the longest possible pass, or the semaphore reclaims a slot from
 * a pass that is still running and the cluster-wide cap quietly stops holding.
 * The distill call alone can now wait 11 minutes on the low-priority LiteLLM
 * key, so this is 20.
 */
const SLOT_TTL_MS = 20 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

let worker: Worker<UsagePatternJobData> | undefined;

async function processJob(job: Job<UsagePatternJobData>): Promise<unknown> {
  const { orgId, agentSlug, windowDays, bucket, trigger } = job.data;

  // Cheap guard against the one overlap worth avoiding: a human clicking the
  // Memory tab's synthesize button on the same agent this pod is about to
  // process. Both paths sweep and rewrite the same `kind:usage` blob, so
  // running them together can leave two copies in the bank. Process-local, so
  // it does not see a pass running on another replica; that window is small
  // enough to accept rather than take a distributed lock on every pass.
  if (usagePatternJob(orgId, agentSlug)?.status === "running") {
    log.info(`[usage-pattern-worker] ${agentSlug}: a manual pass is already running here, skipping`);
    return { slug: agentSlug, skipped: "already-running" };
  }

  // The roster checked this at enqueue time, but a week's jobs drain two at a
  // time and an agent can be deleted while its job waits. Runs and memory files
  // outlive the agent row, so synthesis would still find a full corpus, spend
  // one of very few cluster-wide LLM slots on it, and write a file that
  // getUsagePatternFile can never return again. Same defensive re-check the
  // daily-brief worker does on its own enable flag.
  const agent = await prisma.agent.findFirst({ where: { orgId, slug: agentSlug }, select: { id: true } });
  if (!agent) {
    log.info(`[usage-pattern-worker] ${agentSlug}: agent no longer exists, skipping`);
    return { slug: agentSlug, skipped: "agent-deleted" };
  }

  const end = new Date();
  const start = new Date(end.getTime() - windowDays * DAY_MS);

  const outcome = await withGlobalLlmSlot(
    {
      key: SLOT_KEY,
      cap: CONFIG.usagePatternGlobalConcurrency,
      waitMs: CONFIG.usagePatternSlotWaitMs,
      ttlMs: SLOT_TTL_MS,
      label: "usage-pattern-slot",
    },
    () => synthesizeUsagePatterns(orgId, agentSlug, { start, end }),
  );

  // The only outcome that is a transient failure rather than a finding. Every
  // other skip is a true statement about the corpus and retrying would just
  // spend the tokens again to reach the same answer; this one means we never
  // got an answer at all, so it is thrown to spend an attempt on it.
  if (outcome.skipped === "distill-failed") {
    throw new Error(`distill unavailable for ${agentSlug}`);
  }

  log.info(
    `[usage-pattern-worker] ${agentSlug} (${trigger}, ${bucket}): ` +
      `${outcome.patternsWritten} pattern(s) from ${outcome.runCount} run(s)` +
      `${outcome.skipped ? `, skipped=${outcome.skipped}` : ""}`,
  );
  return outcome;
}

export function initUsagePatternWorker(): Worker<UsagePatternJobData> {
  const concurrency = CONFIG.usagePatternConcurrency;
  worker = new Worker<UsagePatternJobData>(USAGE_PATTERN_QUEUE_NAME, processJob, {
    connection: redisService.getConnection(),
    concurrency,
  });

  worker.on("failed", (job, err) => {
    log.warn(`[usage-pattern-worker] job ${job?.id} (${job?.data?.agentSlug}) failed: ${errMsg(err)}`);
  });
  worker.on("error", (err) => {
    log.error(`[usage-pattern-worker] worker error: ${errMsg(err)}`);
  });

  log.info(
    `[usage-pattern-worker] started (concurrency=${concurrency}, globalCap=${CONFIG.usagePatternGlobalConcurrency})`,
  );
  return worker;
}

export async function closeUsagePatternWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
}
