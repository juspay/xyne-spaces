/**
 * Queues for the awakening pipeline.
 *
 * TWO queues, one repeatable scheduler:
 *
 *   agent-awakening-tick   — ONE repeatable job for the whole fleet. Every
 *                            TICK_MS it claims the agents that are due and
 *                            fans them out. Deliberately not one repeatable
 *                            job per agent: BullMQ schedulers live in Redis
 *                            with no auto-reconcile from Postgres (see the
 *                            comment in main.ts), so a Redis wipe would
 *                            silently stop every agent forever. With a single
 *                            tick, due-ness lives in Postgres and a wipe costs
 *                            exactly one missed tick.
 *
 *   agent-awakening-window — the per-agent work. Retried with backoff; a
 *                            failure here must not lose the wake.
 */

import { Queue } from "bullmq";
import { redisService } from "../redis.js";

export interface AwakeningWindowJobData {
  agentId: string;
  orgId: string;
  kind: "heartbeat" | "reflex";
  /** Stamped at claim time so a delayed job can tell how late it is. */
  claimedAtMs: number;
}

export interface AwakeningReflexJobData {
  agentId: string;
  orgId: string;
  claimedAtMs: number;
}

export const TICK_QUEUE_NAME = "agent-awakening-tick";
export const REFLEX_QUEUE_NAME = "agent-awakening-reflex";
export const WINDOW_QUEUE_NAME = "agent-awakening-window";
export const TICK_SCHEDULER_ID = "awakening-tick";

/** How often the fleet is scanned for due agents. */
export const TICK_INTERVAL_MS = Number(process.env["AWAKENING_TICK_MS"] ?? 60_000);

let tickQueue: Queue | undefined;
let windowQueue: Queue<AwakeningWindowJobData> | undefined;
let reflexQueue: Queue<AwakeningReflexJobData> | undefined;

export function getTickQueue(): Queue {
  if (!tickQueue) {
    tickQueue = new Queue(TICK_QUEUE_NAME, {
      connection: redisService.getConnection(),
      // The tick is self-rescheduling and idempotent: a dropped tick is
      // recovered by the next one, so retrying a failed tick only risks
      // double-claiming. Never retry.
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    });
  }
  return tickQueue;
}

export function getWindowQueue(): Queue<AwakeningWindowJobData> {
  if (!windowQueue) {
    windowQueue = new Queue<AwakeningWindowJobData>(WINDOW_QUEUE_NAME, {
      connection: redisService.getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  }
  return windowQueue;
}

/**
 * Register the single fleet-wide tick. Idempotent by design — calling it on
 * every pod boot converges on one scheduler, which is what makes recovery
 * from a Redis wipe automatic.
 */
export async function ensureTickScheduler(): Promise<void> {
  await getTickQueue().upsertJobScheduler(
    TICK_SCHEDULER_ID,
    { every: TICK_INTERVAL_MS },
    { name: "awakening-tick", data: {} },
  );
}

/**
 * Reflex checks get their own queue so a burst of them can never starve the
 * heartbeat queue — they run on a much faster cadence and are far more numerous.
 */
export function getReflexQueue(): Queue<AwakeningReflexJobData> {
  if (!reflexQueue) {
    reflexQueue = new Queue<AwakeningReflexJobData>(REFLEX_QUEUE_NAME, {
      connection: redisService.getConnection(),
      // A missed reflex check costs nothing: the next one re-counts the same
      // window from the same watermark. Retrying just adds duplicate load.
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    });
  }
  return reflexQueue;
}

export async function enqueueReflexCheck(data: AwakeningReflexJobData): Promise<void> {
  await getReflexQueue().add("reflex", data, { jobId: `awk-reflex-${data.agentId}-${data.claimedAtMs}` });
}

export async function enqueueWindow(data: AwakeningWindowJobData): Promise<void> {
  // jobId derived from the claim instant: if the same agent is somehow claimed
  // twice for the same beat, BullMQ de-duplicates instead of running twice.
  await getWindowQueue().add("window", data, {
    jobId: `awk-${data.kind}-${data.agentId}-${data.claimedAtMs}`,
  });
}

export async function closeAwakeningQueues(): Promise<void> {
  await tickQueue?.close().catch(() => {});
  await windowQueue?.close().catch(() => {});
  await reflexQueue?.close().catch(() => {});
  tickQueue = undefined;
  windowQueue = undefined;
  reflexQueue = undefined;
}
