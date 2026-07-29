/**
 * BullMQ queue for SHARED-AGENT memory backfill jobs (the "Backfill memory from
 * past sessions" action on a normal agent's Memory tab).
 *
 * Why a queue: `backfillBatches` walks a date range of transcripts and
 * auto-curates each session inline — an LLM call per session (see
 * memoryCronService). Running it in the HTTP request blows past the nginx
 * gateway timeout (~60s) → 504, which is exactly what a 30-day range produced.
 * Enqueue + 202 instead; a worker (agent-backfill-worker.ts) runs it async and
 * the UI polls the Pending Review counts.
 *
 * jobId is keyed off `agentSlug:from:to` so re-triggering the same range dedups
 * at the queue level (BullMQ refuses a duplicate id). Mirrors the Digital Twin
 * backfill queue.
 */

import { Queue } from "bullmq";
import { redisService } from "../redis.js";

export interface AgentBackfillJobData {
  agentSlug: string;
  /** Inclusive range, YYYY-MM-DD. */
  from: string;
  to: string;
  /** claw_auth user id that triggered it (audit only). */
  requestedBy?: string;
}

export const AGENT_BACKFILL_QUEUE_NAME = "agent-memory-backfill";

let queue: Queue<AgentBackfillJobData> | undefined;

export function getAgentBackfillQueue(): Queue<AgentBackfillJobData> {
  if (!queue) {
    queue = new Queue<AgentBackfillJobData>(AGENT_BACKFILL_QUEUE_NAME, {
      connection: redisService.getConnection(),
      defaultJobOptions: {
        // The curator can fail transiently (LLM rate-limit, Spaces 5xx); retry.
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    });
  }
  return queue;
}

function jobIdFor(agentSlug: string, from: string, to: string): string {
  // BullMQ rejects custom job ids containing ":" ("Custom Id cannot contain :")
  // — colons are its own key delimiter. This id used colons since day one, so
  // every UI backfill 500'd with "Internal error" (found 2026-07-17). Dashes
  // keep the same (agent, range) dedupe semantics.
  return `agent-backfill_${agentSlug}_${from}_${to}`;
}

/**
 * Enqueue a shared-agent backfill. Returns the BullMQ job id (also the external
 * handle for status checks). Idempotent per (agent, range): if an identical job
 * is already queued/running, reuse it; a finished/failed one is replaced so a
 * re-trigger re-runs.
 */
export async function enqueueAgentBackfill(args: {
  agentSlug: string;
  from: string;
  to: string;
  requestedBy?: string;
}): Promise<string> {
  const data: AgentBackfillJobData = {
    agentSlug: args.agentSlug,
    from: args.from,
    to: args.to,
    ...(args.requestedBy ? { requestedBy: args.requestedBy } : {}),
  };
  const id = jobIdFor(args.agentSlug, args.from, args.to);
  const existing = await getAgentBackfillQueue().getJob(id);
  if (existing) {
    const state = await existing.getState().catch(() => "unknown");
    if (state === "active" || state === "waiting" || state === "delayed") return id;
    await existing.remove().catch(() => {});
  }
  await getAgentBackfillQueue().add("backfill", data, { jobId: id });
  return id;
}

export async function closeAgentBackfillQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
