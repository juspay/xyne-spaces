/**
 * Worker for the shared-agent memory backfill queue. Runs `backfillBatches`
 * (walk date range → create pending batches → auto-curate each session via the
 * curator LLM) OUT of the HTTP request path so it can't 504. See
 * agent-backfill-queue.ts for why.
 *
 * concurrency=1: the curator LLM is heavy and shares LiteLLM slots with live
 * agent runs — one backfill at a time keeps it from starving interactive load.
 */

import { Worker, type Job } from "bullmq";
import { errMsg } from "../lib/errors.js";
import { redisService } from "../redis.js";
import { createLogger, createTraceId } from "../logger.js";
import { backfillBatches } from "../services/memoryCronService.js";
import { AGENT_BACKFILL_QUEUE_NAME, type AgentBackfillJobData } from "./agent-backfill-queue.js";

const logger = createLogger("agent-backfill-worker", createTraceId());

let worker: Worker<AgentBackfillJobData> | undefined;

export function initAgentBackfillWorker(): Worker<AgentBackfillJobData> {
  worker = new Worker<AgentBackfillJobData>(
    AGENT_BACKFILL_QUEUE_NAME,
    async (job: Job<AgentBackfillJobData>) => {
      const { agentSlug, from, to, requestedBy } = job.data;
      logger.info("[agent-backfill] start", { agentSlug, from, to, requestedBy, jobId: job.id });
      const summary = await backfillBatches(agentSlug, { from, to });
      logger.info("[agent-backfill] done", { agentSlug, jobId: job.id, ...summary });
      return summary;
    },
    {
      connection: redisService.getConnection(),
      concurrency: 1,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error("[agent-backfill] job failed", {
      jobId: job?.id,
      agentSlug: job?.data?.agentSlug,
      err: errMsg(err),
    });
  });

  return worker;
}

export async function closeAgentBackfillWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
}
