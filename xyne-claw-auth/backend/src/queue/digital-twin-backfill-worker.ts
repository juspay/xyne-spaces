/**
 * BullMQ worker for Digital Twin backfill jobs.
 *
 * Walks a per-source time window newest → oldest in month-sized chunks.
 * After each chunk, persists the cursor on User.digitalTwinBackfillState
 * so the next invocation (after pod restart or natural job retry) resumes
 * exactly where this one stopped — no duplicate curator calls, no skipped
 * windows.
 *
 * Convention: cursor is the *upper bound* of the next chunk to process.
 * `complete=true` when cursor < from (we've walked past the lower bound).
 */

import { Worker, type Job } from "bullmq";
import { prisma } from "../db.js";
import { redisService } from "../redis.js";
import { createLogger, createTraceId } from "../logger.js";
import {
  fetchUserMessages,
  fetchUserHostedCalls,
  fetchUserCanvases,
} from "../services/userMemoryFetcher.js";
import { curateAndPersistBatch } from "../services/userMemoryCuratorClient.js";
import type { BackfillJobData, BackfillSource } from "./digital-twin-backfill-queue.js";

const logger = createLogger("digital-twin-backfill", createTraceId());
const QUEUE_NAME = "digital-twin-backfill";

/** One window = one month. Each window is one curator call (batches of 50
 *  records max). 24-month backfill → up to 24 windows × 3 sources = 72 calls. */
const WINDOW_DAYS = 30;
/** Batch records this size into the curator. The curator caps at 50; we
 *  batch in 40s to leave headroom. */
const BATCH_SIZE = 40;

interface BackfillState {
  [source: string]: {
    from: string;
    to: string;
    cursor: string;
    complete: boolean;
  };
}

async function fetchForSource(
  source: BackfillSource,
  userId: string,
  window: { from: Date; to: Date },
) {
  if (source === "messages") return fetchUserMessages(userId, window);
  if (source === "calls") return fetchUserHostedCalls(userId, window);
  return fetchUserCanvases(userId, window);
}

async function processOneWindow(
  job: Job<BackfillJobData>,
  userId: string,
  source: BackfillSource,
  windowFrom: Date,
  windowTo: Date,
): Promise<{ candidates: number; records: number }> {
  const records = await fetchForSource(source, userId, { from: windowFrom, to: windowTo });
  if (records.length === 0) return { candidates: 0, records: 0 };

  const windowKey = `${windowFrom.toISOString().slice(0, 7)}`;  // YYYY-MM
  const source_str = `backfill:${job.id ?? "unknown"}:${source}:${windowKey}`;

  let totalInserted = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const inserted = await curateAndPersistBatch({
      userId,
      window: { from: windowFrom, to: windowTo },
      records: batch,
      source: source_str,
    });
    totalInserted += inserted;
  }
  return { candidates: totalInserted, records: records.length };
}

async function readBackfillState(userId: string): Promise<BackfillState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { digitalTwinBackfillState: true, digitalTwinEnabled: true },
  });
  if (!user?.digitalTwinEnabled) return {};
  const raw = user.digitalTwinBackfillState as unknown;
  if (!raw || typeof raw !== "object") return {};
  return raw as BackfillState;
}

async function writeCursor(userId: string, source: BackfillSource, cursor: Date, complete: boolean): Promise<void> {
  // Read-modify-write the JSONB column. Concurrent updates between sources
  // for the same user could clobber — risk is small because we have one
  // job per source, but worth noting if the worker concurrency is raised.
  const state = await readBackfillState(userId);
  const entry = state[source] ?? { from: cursor.toISOString(), to: cursor.toISOString(), cursor: cursor.toISOString(), complete: false };
  entry.cursor = cursor.toISOString();
  entry.complete = complete;
  state[source] = entry;
  await prisma.user.update({
    where: { id: userId },
    data: { digitalTwinBackfillState: state as unknown as object },
  });
}

/**
 * Initialize the BullMQ worker. Mirrors run-recovery-worker.ts pattern.
 * Call from main.ts at startup.
 */
export function initDigitalTwinBackfillWorker(): Worker<BackfillJobData> {
  const worker = new Worker<BackfillJobData>(
    QUEUE_NAME,
    async (job: Job<BackfillJobData>) => {
      const { userId, source } = job.data;
      const from = new Date(job.data.from);
      const to = new Date(job.data.to);

      const state = await readBackfillState(userId);
      const entry = state[source];
      // Resume from cursor if it exists, else from the upper bound `to`.
      let windowUpper = entry?.cursor ? new Date(entry.cursor) : to;
      // Idempotency: if we've already walked past `from`, mark complete and return.
      if (entry?.complete) {
        logger.info("[backfill] already complete — skipping", { userId, source });
        return { candidates: 0, records: 0, status: "already-complete" };
      }

      let totalCandidates = 0;
      let totalRecords = 0;

      while (windowUpper > from) {
        const windowLower = new Date(windowUpper.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);
        const effectiveLower = windowLower < from ? from : windowLower;

        try {
          const result = await processOneWindow(job, userId, source, effectiveLower, windowUpper);
          totalCandidates += result.candidates;
          totalRecords += result.records;
        } catch (err) {
          logger.error("[backfill] window failed — saving cursor for retry", {
            userId,
            source,
            windowUpper: windowUpper.toISOString(),
            err: err instanceof Error ? err.message : String(err),
          });
          await writeCursor(userId, source, windowUpper, false);
          throw err;  // BullMQ retries per defaultJobOptions
        }

        windowUpper = effectiveLower;
        await writeCursor(userId, source, windowUpper, windowUpper <= from);

        // Yield between windows so a heavy backfill doesn't monopolize Redis.
        await new Promise((r) => setTimeout(r, 250));
      }

      await writeCursor(userId, source, from, true);
      logger.info("[backfill] complete", {
        userId,
        source,
        totalCandidates,
        totalRecords,
      });
      return { candidates: totalCandidates, records: totalRecords, status: "complete" };
    },
    {
      connection: redisService.getConnection(),
      concurrency: Number(process.env["DIGITAL_TWIN_BACKFILL_CONCURRENCY"] ?? 2),
      lockDuration: 60_000,
    },
  );

  worker.on("completed", (job) => {
    logger.info("[backfill] job completed", { jobId: job.id, userId: job.data.userId, source: job.data.source });
  });
  worker.on("failed", (job, err) => {
    logger.warn("[backfill] job failed", {
      jobId: job?.id,
      userId: job?.data.userId,
      source: job?.data.source,
      err: err.message,
    });
  });

  return worker;
}
