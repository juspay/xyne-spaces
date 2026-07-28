/**
 * BullMQ queue for entity-extraction type-discovery runs.
 *
 * Producer only — the consumer lives in entity-extraction-worker.ts. A full
 * channel is ~140 LLM calls at 20-75s each, so this can never run in an HTTP
 * request: the handler creates the run row, enqueues, and returns 202.
 *
 * jobId is the run id, so re-triggering an in-flight run is a no-op rather than
 * a second type-discovery pass over the same channel.
 */

import { Queue } from "bullmq";
import { redisService } from "../redis.js";

export interface EntityExtractionJobData {
  runId: string;
  workspaceId: string;
  channelId: string;
}

/**
 * NOT "entity-extraction": the Spaces backend runs a Bull v3 queue of that exact
 * name on the SAME Redis. Bull v3 and BullMQ share the `bull:<name>:` keyspace,
 * so it would pick up our jobs and fail them with "Missing process handler for
 * job type discover-types" — the job never reaches our worker and the run hangs
 * in RUNNING until attempts are exhausted.
 *
 * The name also states the scope correctly: claw-auth discovers TYPES; the
 * backend owns entity/mention extraction.
 */
export const ENTITY_EXTRACTION_QUEUE_NAME = "entity-type-discovery";

let queue: Queue<EntityExtractionJobData> | undefined;

export function getEntityExtractionQueue(): Queue<EntityExtractionJobData> {
  if (!queue) {
    queue = new Queue<EntityExtractionJobData>(ENTITY_EXTRACTION_QUEUE_NAME, {
      connection: redisService.getConnection(),
      defaultJobOptions: {
        // Extraction is expensive and mostly fails for transient reasons
        // (endpoint contention). Two retries, spaced widely.
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 50,
        // Kept on failure so a dead run is inspectable.
        removeOnFail: 100,
      },
    });
  }
  return queue;
}

/**
 * Enqueue a type-discovery run. Idempotent per run id: an already
 * queued/running job is reused; a finished/failed one is replaced so a
 * re-trigger re-runs.
 */
export async function enqueueEntityExtraction(data: EntityExtractionJobData): Promise<string> {
  // BullMQ rejects custom job ids containing ":" — it's their key delimiter.
  const id = `entity-type-discovery_${data.runId}`;
  const existing = await getEntityExtractionQueue().getJob(id);
  if (existing) {
    const state = await existing.getState().catch(() => "unknown");
    if (state === "active" || state === "waiting" || state === "delayed") return id;
    await existing.remove().catch(() => {});
  }
  await getEntityExtractionQueue().add("discover-types", data, { jobId: id });
  return id;
}

export async function closeEntityExtractionQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
