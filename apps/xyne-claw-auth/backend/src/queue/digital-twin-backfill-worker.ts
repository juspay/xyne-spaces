/**
 * BullMQ worker for Digital Twin backfill jobs.
 *
 * Walks a per-source time window oldest → newest in month-sized chunks.
 * After each chunk, persists the cursor on User.digitalTwinBackfillState
 * so the next invocation (after pod restart or natural job retry) resumes
 * exactly where this one stopped — no duplicate curator calls, no skipped
 * windows.
 *
 * Convention: cursor is the *lower bound* of the next chunk to process,
 * seeded at `from`. `complete=true` once cursor reaches `to`.
 */

import { Worker, type Job } from "bullmq";
import { errMsg } from "../lib/errors.js";
import { prisma } from "../db.js";
import { redisService } from "../redis.js";
import { createLogger, createTraceId } from "../logger.js";
import { fetchSourceRecords } from "../services/twinSourceRecords.js";
import { curateRecordsInBatches } from "../services/userMemoryCuratorClient.js";
import { recordPipelineEvent } from "../services/digitalTwinPipelineEvents.js";
import { writeBackfillState } from "../services/digitalTwinLifecycle.js";
import {
  asBackfillState,
  BACKFILL_WINDOW_MS,
  recoverableSources,
  seedBackfillProgress,
  type BackfillEntry,
  type BackfillProgress,
  type BackfillSource,
  type StrictBackfillState,
} from "../services/digitalTwinBackfillState.js";
import {
  DIGITAL_TWIN_BACKFILL_QUEUE_NAME,
  enqueueDigitalTwinBackfill,
  backfillJobIsLive,
  type BackfillJobData,
} from "./digital-twin-backfill-queue.js";

const logger = createLogger("digital-twin-backfill", createTraceId());

/** Fields a single writeProgress call can mutate. `progress` is a shallow merge
 *  into the (seeded) progress object; `accumulate` adds to the running sums
 *  read-modify-write style so concurrent windows don't clobber counts;
 *  everything else patches the entry. */
interface ProgressPatch {
  cursor?: Date;
  complete?: boolean;
  progress?: Partial<Omit<BackfillProgress, "recordsSeen" | "candidatesMade" | "windowsDone" | "updatedAt">>;
  accumulate?: { recordsSeen?: number; candidatesMade?: number; windowsDone?: number };
}

async function processOneWindow(
  job: Job<BackfillJobData>,
  userId: string,
  source: BackfillSource,
  windowFrom: Date,
  windowTo: Date,
): Promise<{ candidates: number; records: number }> {
  const records = await fetchSourceRecords(source, userId, { from: windowFrom, to: windowTo });

  const windowKey = `${windowFrom.toISOString().slice(0, 7)}`;  // YYYY-MM
  const source_str = `backfill:${job.id ?? "unknown"}:${source}:${windowKey}`;

  if (records.length === 0) {
    // Record the empty window so it's visible in the pipeline feed (otherwise
    // curateAndPersistBatch never runs and no event is written for it).
    await recordPipelineEvent({
      userId,
      source: source_str,
      window: { from: windowFrom, to: windowTo },
      status: "empty",
      recordCount: 0,
    });
    return { candidates: 0, records: 0 };
  }

  return {
    candidates: await curateRecordsInBatches({
      userId,
      window: { from: windowFrom, to: windowTo },
      records,
      source: source_str,
    }),
    records: records.length,
  };
}

async function readBackfillState(userId: string): Promise<StrictBackfillState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { digitalTwinBackfillState: true, digitalTwinEnabled: true },
  });
  if (!user?.digitalTwinEnabled) return {};
  return (asBackfillState(user.digitalTwinBackfillState) ?? {}) as StrictBackfillState;
}

async function writeProgress(userId: string, source: BackfillSource, patch: ProgressPatch): Promise<void> {
  // Read-modify-write the JSONB column. Concurrent updates between sources
  // for the same user could clobber — risk is small because we have one
  // job per source, but worth noting if the worker concurrency is raised.
  const state = await readBackfillState(userId);
  const cursorIso = patch.cursor?.toISOString();
  const entry: BackfillEntry =
    state[source] ??
    {
      from: cursorIso ?? new Date().toISOString(),
      to: cursorIso ?? new Date().toISOString(),
      cursor: cursorIso ?? new Date().toISOString(),
      complete: false,
    };
  if (cursorIso !== undefined) entry.cursor = cursorIso;
  if (patch.complete !== undefined) entry.complete = patch.complete;

  const nowIso = new Date().toISOString();
  const progress = entry.progress ?? seedBackfillProgress(entry.from, entry.to, nowIso);
  if (patch.progress) Object.assign(progress, patch.progress);
  if (patch.accumulate) {
    if (patch.accumulate.recordsSeen) progress.recordsSeen += patch.accumulate.recordsSeen;
    if (patch.accumulate.candidatesMade) progress.candidatesMade += patch.accumulate.candidatesMade;
    if (patch.accumulate.windowsDone) progress.windowsDone += patch.accumulate.windowsDone;
  }
  progress.updatedAt = nowIso;  // heartbeat on every write
  entry.progress = progress;

  state[source] = entry;
  await writeBackfillState(userId, state);
}

/**
 * Startup self-heal for wedged backfills.
 *
 * A backfill source that is INCOMPLETE, NOT paused, and has NO live queue job
 * (its job failed — e.g. it stalled past maxStalledCount before that was raised,
 * or was otherwise lost) will never make progress on its own: nothing re-enqueues
 * a failed backfill. This sweep re-enqueues each such source; the worker resumes
 * it from the persisted cursor, so it's safe + idempotent (enqueue first removes
 * any dead job with the same id). This is what un-wedges a backfill stuck at a
 * partial % with a `failed` job. Best-effort; never throws. Returns #re-queued.
 */
async function recoverIncompleteBackfills(): Promise<number> {
  let requeued = 0;
  try {
    const users = await prisma.user.findMany({
      where: { digitalTwinEnabled: true },
      select: { id: true, digitalTwinBackfillState: true },
    });
    for (const u of users) {
      const state = asBackfillState(u.digitalTwinBackfillState);
      if (!state) continue;
      // Skips done, deliberately paused, or malformed-window sources.
      for (const source of recoverableSources(state)) {
        // Skip if a job is already progressing — re-enqueuing would orphan it.
        if (await backfillJobIsLive(u.id, source)) continue;
        const entry = state[source]!;
        await enqueueDigitalTwinBackfill({
          userId: u.id,
          source,
          from: new Date(entry.from!),
          to: new Date(entry.to!),
        });
        requeued += 1;
        logger.info("[backfill] self-heal re-enqueued wedged source", { userId: u.id, source, cursor: entry.cursor });
      }
    }
    if (requeued > 0) logger.info(`[backfill] self-heal re-enqueued ${requeued} incomplete source(s) on startup`);
  } catch (err) {
    logger.warn("[backfill] self-heal sweep failed (non-fatal)", { err: errMsg(err) });
  }
  return requeued;
}

/**
 * Initialize the BullMQ worker. Mirrors run-recovery-worker.ts pattern.
 * Call from main.ts at startup.
 */
export function initDigitalTwinBackfillWorker(): Worker<BackfillJobData> {
  const worker = new Worker<BackfillJobData>(
    DIGITAL_TWIN_BACKFILL_QUEUE_NAME,
    async (job: Job<BackfillJobData>) => {
      const { userId, source } = job.data;
      const from = new Date(job.data.from);
      const to = new Date(job.data.to);

      const state = await readBackfillState(userId);
      const entry = state[source];
      // CHRONOLOGICAL walk: oldest → newest. Resume from cursor (lower bound of
      // the next chunk) if it exists, else start at `from`. Ingesting in time
      // order lets Hindsight build evolution observations FORWARD (A → then B),
      // and aligns `mentioned_at` (learn time) with the real occurred time.
      let windowLower = entry?.cursor ? new Date(entry.cursor) : from;
      // Idempotency: if we've already walked up to `to`, mark complete and return.
      if (entry?.complete) {
        logger.info("[backfill] already complete — skipping", { userId, source });
        return { candidates: 0, records: 0, status: "already-complete" };
      }

      let totalCandidates = 0;
      let totalRecords = 0;

      while (windowLower < to) {
        // Cooperative pause. BullMQ can't stop an ACTIVE (locked) job from the
        // outside — /backfill/pause therefore just stamps `pausedAt` on the
        // persisted state, and WE honor it here at each window boundary. Stop
        // GRACEFULLY (return, not throw) with the cursor already saved, so the
        // job completes cleanly and /backfill/resume re-enqueues from exactly
        // here. Without this check the worker walked to the end regardless of the
        // pause — the "I paused but it's still running" bug.
        const live = await readBackfillState(userId);
        if (live[source]?.pausedAt) {
          logger.info("[backfill] paused mid-walk — stopping gracefully", {
            userId,
            source,
            cursor: windowLower.toISOString(),
          });
          await writeProgress(userId, source, { progress: { currentWindow: null } });
          return { candidates: totalCandidates, records: totalRecords, status: "paused" };
        }

        const nextUpper = new Date(windowLower.getTime() + BACKFILL_WINDOW_MS);
        const effectiveUpper = nextUpper > to ? to : nextUpper;

        // Mark the window we're about to work so a mid-window crash / a status
        // poll sees what's in flight. Cursor is unchanged here.
        await writeProgress(userId, source, {
          progress: {
            currentWindow: { from: windowLower.toISOString(), to: effectiveUpper.toISOString() },
          },
        });

        let result: { candidates: number; records: number };
        try {
          result = await processOneWindow(job, userId, source, windowLower, effectiveUpper);
          totalCandidates += result.candidates;
          totalRecords += result.records;
        } catch (err) {
          logger.error("[backfill] window failed — saving cursor for retry", {
            userId,
            source,
            windowLower: windowLower.toISOString(),
            err: errMsg(err),
          });
          await writeProgress(userId, source, {
            cursor: windowLower, // unchanged → re-process this window on retry
            complete: false,
            progress: {
              lastError: {
                message: errMsg(err),
                windowUpper: effectiveUpper.toISOString(),
                at: new Date().toISOString(),
              },
            },
          });
          throw err;  // BullMQ retries per defaultJobOptions
        }

        windowLower = effectiveUpper;
        await writeProgress(userId, source, {
          cursor: windowLower,
          complete: windowLower >= to,
          accumulate: { recordsSeen: result.records, candidatesMade: result.candidates, windowsDone: 1 },
          progress: { currentWindow: null, lastError: null },
        });

        // Yield between windows so a heavy backfill doesn't monopolize Redis.
        await new Promise((r) => setTimeout(r, 250));
      }

      await writeProgress(userId, source, {
        cursor: to,
        complete: true,
        progress: { currentWindow: null, lastError: null },
      });
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
      // A single backfill window can run for minutes (LLM curation), and the job
      // is DESIGNED to survive restarts by resuming from the persisted cursor
      // (see the queue docstring). But BullMQ's DEFAULT maxStalledCount is 1, so
      // the SECOND orphaned-lock — trivial under a dev file-watcher or a rolling
      // deploy — failed the job PERMANENTLY ("job stalled more than allowable
      // limit") and nothing re-enqueued it, wedging the backfill at a partial %
      // for days. Allow many stalls; recoverIncompleteBackfills() below re-queues
      // anything that still slips through.
      maxStalledCount: Number(process.env["DIGITAL_TWIN_BACKFILL_MAX_STALLED"] ?? 10),
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

  // Self-heal any backfill that got wedged (a `failed` job with no re-enqueue)
  // before this process started — e.g. jobs killed by the old maxStalledCount=1.
  // Deferred so the queue connection + worker are fully ready first.
  setTimeout(() => {
    void recoverIncompleteBackfills();
  }, 10_000).unref?.();

  return worker;
}
