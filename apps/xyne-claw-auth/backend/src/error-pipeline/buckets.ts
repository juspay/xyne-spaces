import type { WorkItem, IncomingError, ClassifyResult } from "./types.js";
import { errorKeyFor } from "./errorKey.js";
import { getQueue, type QueueStats } from "./queue.js";
import { getRules, laneNames } from "./rules.js";
import { createLogger } from "../logger.js";

const log = createLogger("error-pipeline");

/**
 * Bucket routing — one durable lane per stable domain (NOT per error).
 *
 * There is NO hardcoded bucket list here. The taxonomy (names, descriptions,
 * keywords/markers) lives in the error_buckets table; this module only applies
 * it. No noise judgment, no drop lever — EVERYTHING queues; the agent is the
 * only judge of "real bug vs not", at work time.
 */

export type EnqueueOutcome = "queued" | "deduped";

export async function routeError(
  error: IncomingError,
  classification: ClassifyResult,
): Promise<{ errorKey: string; outcome: EnqueueOutcome; bucket: string }> {
  const errorKey = errorKeyFor(error);

  const rules = await getRules();
  const cfg = rules?.find((b) => b.name === classification.bucket);

  // Known bucket → itself; unknown name → default; DB unavailable → trust the
  // classifier (its names come from the same table anyway).
  const bucket = rules ? (cfg ? classification.bucket : "default") : classification.bucket || "default";

  const item: WorkItem = { errorKey, error, classification, enqueuedAt: Date.now() };
  const queued = await getQueue().enqueue(bucket, item);
  if (!queued) {
    return { errorKey, outcome: "deduped", bucket };
  }

  log.info(`[buckets] queued ${errorKey} → ${bucket} (${classification.signal}:${classification.reason})`);
  return { errorKey, outcome: "queued", bucket };
}

export async function bucketStats(): Promise<Record<string, QueueStats>> {
  return getQueue().stats(await laneNames());
}
