/**
 * Digital Twin user-memory routes — the user-facing surface for the personal
 * memory pipeline. All endpoints are scoped to the requesting user; no admin
 * elevation, no cross-user reads, no "list all users" style queries.
 *
 * Privacy contract:
 *   - All routes use `requireUserAuth` (NOT `requireAuth`) — cookie auth
 *     only, never S2S. This closes the impersonation hole where any
 *     service holding the S2S key could call these routes with an
 *     arbitrary x-user-id and act on a victim's Twin.
 *   - Every read filters by req.headers["x-user-id"] (set by requireUserAuth
 *     from the verified Spaces session).
 *   - Approve/Reject/Edit/Delete also filter by that same userId, so even a
 *     correctly-shaped ID guessed for another user fails the row lookup.
 *   - The route handlers NEVER consult an admin role flag; this is a
 *     per-user surface end to end.
 *
 * Flow:
 *   1. POST /enable with optional backfill window → flips the flag, queues
 *      BullMQ backfill jobs (one per source).
 *   2. Backfill workers + daily worker write `UserMemoryCandidate` rows.
 *   3. GET /clusters surfaces them grouped by subsystem.
 *   4. POST /clusters/:subsystem/approve retains each approved candidate to
 *      Hindsight under tag `user:<userId>` and `subsystem:<subsystem>`.
 *   5. The Digital Twin agent (slug=`digital-twin`) recalls only `user:<userId>`
 *      tagged memories — enforced server-side in memory-search.ts (claw).
 */

import { Router, type Request, type Response } from "express";
import type { DigitalTwinPipelineEvent, Prisma } from "@prisma/client";
import { errMsg } from "../lib/errors.js";
import { DIGITAL_TWIN_BANK_ID, getMemoryProvider } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { createLogger, createTraceId } from "../logger.js";
import { requireUserAuth } from "../middleware/require-auth.js";
import { countUserRecords } from "../services/userMemoryFetcher.js";
import { fetchSourceRecords } from "../services/twinSourceRecords.js";
import { recordPipelineEvent } from "../services/digitalTwinPipelineEvents.js";
import {
  DEFAULT_AUTO_APPROVE_MIN_SCORE,
  curateAndPersistBatch,
  curateRecordsInBatches,
} from "../services/userMemoryCuratorClient.js";
import { ensureTwinBank, listUserTwinMemories, retainTwinMemory } from "../services/twinMemoryBank.js";
import {
  TWIN_AGENT_SLUG,
  MAX_FILE_CHARS,
  MAX_LOADED_FILES,
  MEMORY_FILE_NAME_RE,
  ensureDefaultFiles,
  listFiles,
  upsertFile,
  setLoadInPrompt,
  deleteFile,
  MaxLoadedFilesError,
} from "../services/agentMemoryFiles.js";
import { synthesizeSoulFilesForUser } from "../services/twinSoulSynthesizer.js";
import { disableTwin, enqueueBackfillForAllSources, writeBackfillState } from "../services/digitalTwinLifecycle.js";
import {
  cancelDigitalTwinBackfill,
  enqueueDigitalTwinBackfill,
  backfillJobIsLive,
  probeBackfillJob,
} from "../queue/digital-twin-backfill-queue.js";
import {
  BACKFILL_SOURCES,
  MAX_BACKFILL_MONTHS,
  asBackfillState,
  backfillRangeProblem,
  buildBackfillState,
  summarizeBackfillState,
  applyBackfillPause,
  collectAndClearResumable,
  type StrictBackfillState,
  type BackfillJobProbe,
  type BackfillSource,
} from "../services/digitalTwinBackfillState.js";
import type { UserMemoryCuratorTrace } from "xyne-claw-shared";

const logger = createLogger("digital-twin", createTraceId());
const memory = getMemoryProvider();

/** Per-record curator cost estimate. Haiku 4.5 at ~$0.001 per request for
 *  a 50-record batch ≈ $0.000020 per record. Used for the consent screen. */
const COST_PER_RECORD_USD = 0.000020;
const MIN_AUTO_APPROVE_SCORE = 0.7;
const MAX_AUTO_APPROVE_SCORE = 1;

/** Per-record fact density coefficient. Heuristic — gets refined over time. */
const CANDIDATES_PER_RECORD = 0.06;

/** Per-cluster batch-approve concurrency lock. Same pattern as memory.ts —
 *  in-process dedupe; cluster-wide dedupe once we move to BullMQ. */
const inFlightClusterApprovals = new Set<string>();

/** Per-user disable-with-delete lock. Disable's slow path is N Hindsight
 *  deletes (one per approved memory); for a user with hundreds it would
 *  exceed the gateway timeout, so we return 202 and run deletes in the
 *  background. This Set dedupes a double-click. */
const inFlightDisables = new Set<string>();

/** Dedupe concurrent soul-synthesis rebuilds per user (N LLM calls, ~30-60s). */
const inFlightSynth = new Set<string>();
/** Pipeline events currently being retried, so a double-click doesn't double-run. */
const inFlightRetry = new Set<string>();

/** Per-user in-flight flag for a manual memory-delete (all / range). Surfaced in
 *  /status as memoryDeleteInProgress so the UI can show a live indicator. */
const inFlightMemDelete = new Set<string>();

/** Bounded-concurrency map — invalidate N memories without firing N parallel
 *  Hindsight calls at once. */
async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
}

/** Reply-first background work: hold `key` in `lock` and run `task` on the next
 *  tick, releasing the lock when it settles. Never catches — each task logs its
 *  own failures. */
function inBackground(lock: Set<string>, key: string, task: () => Promise<void>): void {
  lock.add(key);
  setImmediate(async () => {
    try {
      await task();
    } finally {
      lock.delete(key);
    }
  });
}

/** Bump `counts[status]` by `n`; statuses the map does not track are ignored. */
function addStatusCount(counts: Record<string, number>, status: string, n: number): void {
  if (Object.hasOwn(counts, status)) counts[status] = (counts[status] ?? 0) + n;
}

export const digitalTwinRouter = Router();

function getUserId(req: Request): string | null {
  const v = req.headers["x-user-id"];
  if (typeof v !== "string" || v.length === 0) return null;
  return v;
}

type TwinHandler = (req: Request, res: Response, userId: string) => Promise<void>;

/** Resolve the requesting user or answer 401. Never catches: a handler with no
 *  catch of its own lets errors propagate as before. */
function withUser(fn: TwinHandler) {
  return async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    await fn(req, res, userId);
  };
}

/** withUser + the shared catch: log `failMsg` and answer 500. The 401 guard stays
 *  inside the try, and the inner call is awaited — Express 4 does not forward a
 *  rejected async handler to next(), so an un-awaited rejection would escape. */
function guarded(failMsg: string, fn: TwinHandler) {
  const handler = withUser(fn);
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await handler(req, res);
    } catch (err) {
      logger.error(failMsg, { err: errMsg(err) });
      res.status(500).json({ success: false, error: "Internal error" });
    }
  };
}

// ── Backfill status normalization ──────────────────────────────────────────

/** How long without a progress heartbeat before a running backfill is stalled. */
const BACKFILL_STALL_MS = 120_000;

/** Build the normalized `data.backfill` block from raw backfillState. Returns
 *  null when there's no state at all. Existing backfillState is left untouched
 *  by callers — this is purely additive. The running/paused/stalled math lives
 *  in the pure, unit-tested `summarizeBackfillState`. */
async function buildBackfillBlock(userId: string, raw: unknown): Promise<unknown> {
  const state = asBackfillState(raw);
  if (!state) return null;
  const probeEntries = await Promise.all(
    BACKFILL_SOURCES.map(async (s) => [s, state[s] ? await probeBackfillJob(userId, s) : null] as const),
  );
  const probes = Object.fromEntries(probeEntries) as Partial<Record<BackfillSource, BackfillJobProbe | null>>;
  return summarizeBackfillState(state, probes, { nowMs: Date.now(), stallMs: BACKFILL_STALL_MS });
}

// ── Pipeline events normalization ──────────────────────────────────────────

const PIPELINE_EVENTS_DEFAULT_LIMIT = 50;
const PIPELINE_EVENTS_MAX_LIMIT = 200;

type PipelineEventRow = Omit<DigitalTwinPipelineEvent, "userId" | "records">;

/** Shape used by both the list and detail endpoints (detail adds records+trace). */
function toEventSummary(row: PipelineEventRow) {
  return {
    id: row.id,
    createdAt: row.createdAt,
    runType: row.runType,
    source: row.source,
    sourceKind: row.sourceKind,
    windowFrom: row.windowFrom,
    windowTo: row.windowTo,
    status: row.status,
    recordCount: row.recordCount,
    existingMemoryCount: row.existingMemoryCount,
    emittedCount: row.emittedCount,
    keptCount: row.keptCount,
    candidatesCreated: row.candidatesCreated,
    autoApproved: row.autoApproved,
    durationMs: row.durationMs,
    error: row.error,
    hasTrace: row.trace != null,
  };
}

// ── 1. Status ──────────────────────────────────────────────────────────────

digitalTwinRouter.get("/status", requireUserAuth, guarded("[digital-twin] /status failed", async (req, res, userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      digitalTwinEnabled: true,
      digitalTwinEnabledAt: true,
      digitalTwinBackfillState: true,
      digitalTwinResponseSuffix: true,
      digitalTwinMemoryApprovalMode: true,
      digitalTwinMemoryAutoApproveMinScore: true,
      digitalTwinRespondPolicy: true,
    },
  });
  if (!user) {
    res.status(404).json({ success: false, error: "User not found" });
    return;
  }
  const [pending, total, approved, mdFiles] = await Promise.all([
    prisma.userMemoryCandidate.count({ where: { userId, status: "pending" } }),
    prisma.userMemoryCandidate.count({ where: { userId } }),
    prisma.userMemoryCandidate.count({ where: { userId, status: "approved" } }),
    prisma.userMemoryCandidate.count({
      where: { userId, source: { startsWith: "upload:" } },
    }),
  ]);
  const backfill = await buildBackfillBlock(userId, user.digitalTwinBackfillState);

  // Real memory count — the number of the user's memories actually live in
  // Hindsight, matching what the memories tab shows. This differs from
  // approvedCandidates (which counts approved candidate ROWS and inflates:
  // Hindsight dedupes on retain, and re-backfills re-propose the same facts).
  // MUST use the SAME wide fetch as the memories list route (memory.ts) — the
  // twin bank is shared across users and Hindsight can't tag-filter server-side,
  // so we over-fetch then filter in JS. A smaller limit here caps the count and
  // makes the banner ("from N memories") DISAGREE with the tab ("N memories").
  let memoryCount = 0;
  if (user.digitalTwinEnabled) {
    try {
      const wide = Number(process.env["TWIN_MEMORIES_WIDE_FETCH"] ?? 2000);
      memoryCount = (await listUserTwinMemories(userId, wide)).length;
    } catch (err) {
      logger.warn("[digital-twin] status memoryCount failed", { userId, err: errMsg(err) });
    }
  }

  res.json({
    success: true,
    data: {
      enabled: user.digitalTwinEnabled,
      enabledAt: user.digitalTwinEnabledAt,
      backfillState: user.digitalTwinBackfillState ?? null,
      backfill,
      pendingCandidates: pending,
      totalCandidates: total,
      approvedCandidates: approved,
      memoryCount,
      memoryDeleteInProgress: inFlightMemDelete.has(userId),
      mdFileCount: mdFiles,
      responseSuffix: user.digitalTwinResponseSuffix ?? "",
      respondPolicy: user.digitalTwinRespondPolicy ?? "always",
      memoryApprovalMode: user.digitalTwinMemoryApprovalMode,
      memoryAutoApproveMinScore: user.digitalTwinMemoryAutoApproveMinScore,
    },
  });
}));

// ── 2. Estimate (consent-screen support) ───────────────────────────────────

digitalTwinRouter.get("/estimate", requireUserAuth, guarded("[digital-twin] /estimate failed", async (req, res, userId) => {
  const fromStr = String(req.query["from"] ?? "");
  const toStr = String(req.query["to"] ?? new Date().toISOString().slice(0, 10));
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    res.status(400).json({ success: false, error: "Invalid from/to" });
    return;
  }
  const counts = await countUserRecords(userId, { from, to });
  const totalRecords = counts.messages + counts.calls + counts.canvases;
  const estCandidates = Math.round(totalRecords * CANDIDATES_PER_RECORD);
  const estCostUSD = Number((totalRecords * COST_PER_RECORD_USD).toFixed(2));
  res.json({
    success: true,
    data: { ...counts, totalRecords, estCandidates, estCostUSD },
  });
}));

// ── 3. Enable ──────────────────────────────────────────────────────────────

digitalTwinRouter.post("/enable", requireUserAuth, guarded("[digital-twin] /enable failed", async (req, res, userId) => {
  const body = (req.body ?? {}) as { backfill?: { from?: string; to?: string } | null };
  const now = new Date();
  let backfillState: StrictBackfillState | null = null;
  let from: Date | null = null;
  let to: Date | null = null;

  // If the client sent a backfill object, it MUST have `from`. Silently
  // skipping would be confusing — the user picked a range in the UI and
  // their expectation is that backfill runs. 400 forces the buggy client
  // to fix itself instead of producing a silent "Twin learned nothing".
  if (body.backfill !== undefined && body.backfill !== null && !body.backfill.from) {
    res.status(400).json({ success: false, error: "backfill requires 'from' (or pass backfill=null to skip)" });
    return;
  }

  if (body.backfill && body.backfill.from) {
    from = new Date(body.backfill.from);
    to = body.backfill.to ? new Date(body.backfill.to) : now;
    const problem = backfillRangeProblem(from, to);
    if (problem) {
      res.status(400).json({
        success: false,
        error: problem === "invalid" ? "Invalid backfill range" : `Backfill must span ≤ ${MAX_BACKFILL_MONTHS} months`,
      });
      return;
    }
    backfillState = buildBackfillState({ from, to }, now);
  }

  // Always write the new backfillState (or null if no backfill requested).
  // If we conditionally skipped the field on null, a re-enable that opts
  // out of backfill would inherit the previous run's stale state and the
  // worker would think the new walk was "already complete".
  await writeBackfillState(userId, backfillState, { digitalTwinEnabled: true, digitalTwinEnabledAt: now });

  // Enable Hindsight's observation/temporal layer on the twin bank (per-user
  // scoped) so evolution ("stopped A, now on B") and temporal queries work.
  await ensureTwinBank();

  // Seed the default file-memory structure (soul.md, people.md, …) so the
  // twin has a consistent, always-loaded persona from day one. Idempotent —
  // never clobbers existing/edited files. Non-fatal on error.
  await ensureDefaultFiles(TWIN_AGENT_SLUG, userId).catch((err) => {
    logger.warn("[digital-twin] ensureDefaultFiles failed", {
      userId,
      err: errMsg(err),
    });
  });

  const backfillJobIds = from && to ? await enqueueBackfillForAllSources(userId, { from, to }) : [];

  res.json({
    success: true,
    data: {
      enabled: true,
      enabledAt: now,
      backfillJobIds,
    },
  });
}));

// ── 3b. Pause / Resume backfill ─────────────────────────────────────────────
// Stop the in-flight backfill walk WITHOUT losing progress, and resume it later
// from the exact cursor. Distinct from /disable (which turns the Twin off and
// clears state): pause keeps the Twin enabled and the state intact.

digitalTwinRouter.post("/backfill/pause", requireUserAuth, guarded("[digital-twin] /backfill/pause failed", async (req, res, userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { digitalTwinBackfillState: true },
  });
  const state = asBackfillState(user?.digitalTwinBackfillState);
  if (!state) {
    res.json({ success: true, data: { paused: false, pausedSources: 0, cancelledJobs: 0, message: "No backfill in progress" } });
    return;
  }
  // Remove the in-flight BullMQ jobs so the worker stops walking. The cursor
  // already persisted on the state is the resume point.
  const cancelledJobs = await cancelDigitalTwinBackfill(userId);
  const pausedSources = applyBackfillPause(state, new Date().toISOString());
  await writeBackfillState(userId, state);
  logger.info("[digital-twin] backfill paused", { userId, pausedSources, cancelledJobs });
  res.json({ success: true, data: { paused: pausedSources > 0, pausedSources, cancelledJobs } });
}));

digitalTwinRouter.post("/backfill/resume", requireUserAuth, guarded("[digital-twin] /backfill/resume failed", async (req, res, userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { digitalTwinEnabled: true, digitalTwinBackfillState: true },
  });
  if (!user?.digitalTwinEnabled) {
    res.status(400).json({ success: false, error: "Digital Twin is not enabled" });
    return;
  }
  const state = asBackfillState(user.digitalTwinBackfillState);
  if (!state) {
    res.json({ success: true, data: { resumed: 0, jobIds: [], message: "No backfill to resume" } });
    return;
  }
  // Clear pausedAt on incomplete sources FIRST and persist, so any job still
  // finishing its current window (BullMQ can't stop an active job — it stops
  // itself at the next window check) sees the un-pause and simply continues.
  const resumable = collectAndClearResumable(state);
  await writeBackfillState(userId, state);
  // Then, for each incomplete source with NO live job (it already stopped, or
  // was wedged/failed), enqueue a fresh one from the persisted cursor. Sources
  // whose job is still active are left alone — they resume on their own now
  // that pausedAt is cleared (and a locked job can't be removed anyway).
  const jobIds: string[] = [];
  for (const source of resumable) {
    if (await backfillJobIsLive(userId, source)) continue;
    const entry = state[source]!;
    const jobId = await enqueueDigitalTwinBackfill({
      userId,
      source,
      from: new Date(entry.from!),
      to: new Date(entry.to!),
    });
    jobIds.push(jobId);
  }
  logger.info("[digital-twin] backfill resumed", { userId, resumed: jobIds.length, cleared: resumable.length });
  res.json({ success: true, data: { resumed: jobIds.length, jobIds, sources: resumable.length } });
}));

// ─── Memory files (Memory v2 — deterministic, file-based persona) ─────────
// Named documents (soul.md, people.md, …) the twin always loads. Up to
// MAX_LOADED_FILES are injected into the system prompt, each ≤ MAX_FILE_CHARS.

digitalTwinRouter.get("/memory-files", requireUserAuth, guarded("[digital-twin] list memory-files failed", async (req, res, userId) => {
  // Make sure a returning user who enabled before this feature still gets the
  // default structure.
  await ensureDefaultFiles(TWIN_AGENT_SLUG, userId).catch(() => {});
  const files = await listFiles(TWIN_AGENT_SLUG, userId);
  res.json({
    success: true,
    data: { files, maxLoaded: MAX_LOADED_FILES, maxChars: MAX_FILE_CHARS },
  });
}));

digitalTwinRouter.put("/memory-files/:name", requireUserAuth, guarded("[digital-twin] put memory-file failed", async (req, res, userId) => {
  const name = String(req.params.name ?? "");
  if (!MEMORY_FILE_NAME_RE.test(name)) {
    res.status(400).json({ success: false, error: "Invalid file name" });
    return;
  }
  const body = (req.body ?? {}) as { content?: unknown };
  if (typeof body.content !== "string") {
    res.status(400).json({ success: false, error: "content (string) is required" });
    return;
  }
  const overCap = body.content.length > MAX_FILE_CHARS;
  const file = await upsertFile({
    agentSlug: TWIN_AGENT_SLUG,
    owner: userId,
    name,
    content: body.content,
    updatedBy: "user",
  });
  res.json({ success: true, data: { file, truncated: overCap, maxChars: MAX_FILE_CHARS } });
}));

digitalTwinRouter.post("/memory-files/:name/load", requireUserAuth, guarded("[digital-twin] toggle memory-file load failed", async (req, res, userId) => {
  try {
    const name = String(req.params.name ?? "");
    const body = (req.body ?? {}) as { load?: unknown };
    if (typeof body.load !== "boolean") {
      res.status(400).json({ success: false, error: "load (boolean) is required" });
      return;
    }
    const file = await setLoadInPrompt(TWIN_AGENT_SLUG, userId, name, body.load);
    res.json({ success: true, data: { file } });
  } catch (err) {
    if (err instanceof MaxLoadedFilesError) {
      res.status(400).json({ success: false, error: err.message });
      return;
    }
    if (err instanceof Error && err.message === "not-found") {
      res.status(404).json({ success: false, error: "File not found" });
      return;
    }
    throw err;
  }
}));

digitalTwinRouter.delete("/memory-files/:name", requireUserAuth, guarded("[digital-twin] delete memory-file failed", async (req, res, userId) => {
  const name = String(req.params.name ?? "");
  const deleted = await deleteFile(TWIN_AGENT_SLUG, userId, name);
  res.json({ success: true, data: { deleted } });
}));

// Rebuild the persona files from approved memories (soul synthesizer, Phase 4).
// N LLM calls (~30-60s) → runs in the background, returns 202. The client
// re-fetches /memory-files after a short delay to see the result.
digitalTwinRouter.post("/synthesize", requireUserAuth, withUser(async (req, res, userId) => {
  if (inFlightSynth.has(userId)) {
    res.status(202).json({ success: true, data: { status: "already-running" } });
    return;
  }
  res.status(202).json({ success: true, data: { status: "started" } });
  inBackground(inFlightSynth, userId, async () => {
    try {
      await synthesizeSoulFilesForUser(userId, "manual");
    } catch (err) {
      logger.warn("[digital-twin] synthesize failed", { userId, err: errMsg(err) });
    }
  });
}));

// Manually delete the user's stored twin memories — ALL, or a created-date
// RANGE. Runs in the background (Hindsight invalidations are slow HTTP calls);
// responds 202 and the client polls /status (memoryDeleteInProgress + the
// dropping memoryCount) for a live indicator. Used to wipe + re-backfill clean.
digitalTwinRouter.post("/memories/delete", requireUserAuth, withUser(async (req, res, userId) => {
  const body = (req.body ?? {}) as { mode?: string; from?: string; to?: string };
  const mode = body.mode === "range" ? "range" : "all";

  let fromMs = 0;
  let toMs = 0;
  if (mode === "range") {
    fromMs = Date.parse(body.from ?? "");
    toMs = Date.parse(body.to ?? "");
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      res.status(400).json({ success: false, error: "range requires valid from ≤ to (ISO dates)" });
      return;
    }
  }

  if (inFlightMemDelete.has(userId)) {
    res.status(202).json({ success: true, data: { deleting: true, message: "Delete already running" } });
    return;
  }
  res.status(202).json({ success: true, data: { deleting: true, mode } });

  inBackground(inFlightMemDelete, userId, async () => {
    const userTag = `user:${userId}`;
    let deleted = 0;
    let candidatesDeleted = 0;
    try {
      if (mode === "all") {
        deleted = (await memory.deleteByTag?.(DIGITAL_TWIN_BANK_ID, userTag)) ?? 0;
        candidatesDeleted = (await prisma.userMemoryCandidate.deleteMany({ where: { userId } })).count;
      } else {
        // Range: list the user's memories, keep those whose createdAt is in
        // [from,to], invalidate each.
        const targets = (await listUserTwinMemories(userId, 1000))
          // Observations are derived and cannot be invalidated directly.
          // Removing their raw sources makes Hindsight reconcile them.
          .filter((m) => m.factType?.toLowerCase() !== "observation")
          .filter((m) => {
            const t = Date.parse(m.createdAt ?? "");
            return Number.isFinite(t) && t >= fromMs && t <= toMs;
          });
        await mapPool(targets, 8, async (m) => {
          if (!m.id) return;
          try {
            await memory.deleteMemory(DIGITAL_TWIN_BANK_ID, m.id);
            deleted += 1;
          } catch (err) {
            logger.warn("[digital-twin] range delete: invalidate failed", {
              userId,
              id: m.id,
              err: errMsg(err),
            });
          }
        });
        candidatesDeleted = (
          await prisma.userMemoryCandidate.deleteMany({
            where: { userId, createdAt: { gte: new Date(fromMs), lte: new Date(toMs) } },
          })
        ).count;
      }
      logger.info("[digital-twin] memory delete complete", { userId, mode, deleted, candidatesDeleted });
    } catch (err) {
      logger.error("[digital-twin] memory delete crashed", {
        userId,
        mode,
        err: errMsg(err),
      });
    }
  });
}));

digitalTwinRouter.post("/disable", requireUserAuth, guarded("[digital-twin] /disable failed", async (req, res, userId) => {
  const { deleteMemories } = (req.body ?? {}) as { deleteMemories?: boolean };

  const cancelledJobs = await disableTwin(userId);

  if (!deleteMemories) {
    res.json({
      success: true,
      data: { disabled: true, deletedCandidates: 0, deletedHindsight: 0, cancelledJobs, deleting: false },
    });
    return;
  }

  // Hindsight deletes are sequential 100ms+ HTTP calls. A user with 500
  // approved memories would push the request past the 60s ingress
  // timeout — same architecture as the approve-batch 504 fix. Respond
  // 202, run the deletes in the background, and let the client poll
  // /status to watch approvedCandidates drop to zero.
  if (inFlightDisables.has(userId)) {
    res.status(202).json({
      success: true,
      data: { disabled: true, deleting: true, cancelledJobs, message: "Delete already running" },
    });
    return;
  }

  res.status(202).json({
    success: true,
    data: { disabled: true, deleting: true, cancelledJobs },
  });

  inBackground(inFlightDisables, userId, async () => {
    let deletedHindsight = 0;
    let deletedCandidates = 0;
    try {
      // Delete the user's memories from Hindsight by TAG, not by stored id.
      // candidate.hindsightMemoryId is always null (async retain returns no
      // ids — see the digital-twin memory investigation), so the old per-id
      // delete silently removed nothing. Tag delete reaches every memory the
      // user has in the shared twin bank.
      try {
        deletedHindsight = (await memory.deleteByTag?.(DIGITAL_TWIN_BANK_ID, `user:${userId}`)) ?? 0;
      } catch (err) {
        logger.warn("[digital-twin] hindsight delete-by-tag failed on disable", {
          userId,
          err: errMsg(err),
        });
      }
      const result = await prisma.userMemoryCandidate.deleteMany({ where: { userId } });
      deletedCandidates = result.count;
      logger.info("[digital-twin] disable-delete complete", {
        userId,
        deletedHindsight,
        deletedCandidates,
      });
    } catch (err) {
      logger.error("[digital-twin] disable-delete crashed", {
        userId,
        err: errMsg(err),
      });
    }
  });
}));

// ── Memory graph (constellation edges + entities, from Hindsight) ──────────

/**
 * GET /graph — the constellation's REAL relationships from Hindsight's memory-graph
 * API: nodes = memories, edges = `semantic` (embedding) / `temporal` / `entity`
 * (shared entities) links, plus per-memory extracted entities. Scoped to the
 * requesting user's own memories — Hindsight tag-filters SQL-side, and we
 * additionally drop any edge whose endpoint isn't in this user's node set
 * (defense-in-depth on a shared bank). The frontend joins these onto its own
 * memory list (node id === memory id). Returns an empty graph if the provider
 * lacks the API.
 */
digitalTwinRouter.get("/graph", requireUserAuth, guarded("[digital-twin] /graph failed", async (req, res, userId) => {
  if (typeof memory.getMemoryGraph !== "function") {
    res.json({ success: true, data: { nodes: [], edges: [] } });
    return;
  }
  const userTag = `user:${userId}`;
  const graph = await memory.getMemoryGraph(DIGITAL_TWIN_BANK_ID, { tags: [userTag], limit: 2000 });
  const nodeIds = new Set<string>();
  const nodes = graph.nodes
    .filter((n) => !n.tags || n.tags.includes(userTag))
    .map((n) => {
      nodeIds.add(n.id);
      return {
        id: n.id,
        ...(n.entities?.length ? { entities: n.entities } : {}),
        ...(n.factType ? { factType: n.factType } : {}),
      };
    });
  const edges = graph.edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => ({
      source: e.source,
      target: e.target,
      linkType: e.linkType,
      ...(e.weight != null ? { weight: e.weight } : {}),
    }));
  res.json({ success: true, data: { nodes, edges } });
}));

// ── 4. Clusters (grouped pending view) ─────────────────────────────────────

digitalTwinRouter.get("/clusters", requireUserAuth, guarded("[digital-twin] /clusters failed", async (req, res, userId) => {
  // Aggregate pending counts by subsystem + pull 3 top-signal previews per cluster.
  const grouped = await prisma.userMemoryCandidate.groupBy({
    by: ["subsystem"],
    where: { userId, status: "pending" },
    _count: { _all: true },
  });

  const clusters = await Promise.all(
    grouped.map(async (g) => {
      const top3 = await prisma.userMemoryCandidate.findMany({
        where: { userId, status: "pending", subsystem: g.subsystem },
        orderBy: { signalScore: "desc" },
        take: 3,
        select: { id: true, text: true, signalScore: true },
      });
      return {
        subsystem: g.subsystem,
        pending: g._count._all,
        top3,
      };
    }),
  );

  res.json({ success: true, data: { clusters } });
}));

digitalTwinRouter.get("/clusters/:subsystem", requireUserAuth, guarded("[digital-twin] /clusters/:subsystem failed", async (req, res, userId) => {
  const subsystem = String(req.params["subsystem"]);
  const candidates = await prisma.userMemoryCandidate.findMany({
    where: { userId, subsystem, status: { in: ["pending"] } },
    orderBy: { signalScore: "desc" },
    take: 200,
  });
  res.json({ success: true, data: { subsystem, candidates } });
}));

// ── 5. Cluster batch-approve ───────────────────────────────────────────────

digitalTwinRouter.post("/clusters/:subsystem/approve", requireUserAuth, guarded("[digital-twin] /clusters/:subsystem/approve failed", async (req, res, userId) => {
  const subsystem = String(req.params["subsystem"]);
  const body = (req.body ?? {}) as { candidateIds?: string[] };

  const where: Record<string, unknown> = {
    userId,
    subsystem,
    status: "pending",
  };
  if (Array.isArray(body.candidateIds) && body.candidateIds.length > 0) {
    where["id"] = { in: body.candidateIds };
  }

  const candidates = await prisma.userMemoryCandidate.findMany({ where });
  if (candidates.length === 0) {
    res.json({ success: true, data: { approved: 0, retained: 0 } });
    return;
  }

  const lockKey = `${userId}:${subsystem}`;
  if (inFlightClusterApprovals.has(lockKey)) {
    res.status(202).json({ success: true, data: { processing: true, message: "Cluster approval already running" } });
    return;
  }

  res.status(202).json({
    success: true,
    data: { processing: true, count: candidates.length, subsystem },
  });

  // Background: retain each candidate to Hindsight, update row status.
  inBackground(inFlightClusterApprovals, lockKey, async () => {
    await ensureTwinBank();
    let retained = 0;
    let failed = 0;
    for (const c of candidates) {
      try {
        const hindsightMemoryId = await retainTwinMemory({
          userId,
          subsystem,
          content: c.editedText ?? c.text,
          sourceRefs: c.sourceRefs,
          pipelineEventId: c.pipelineEventId,
        });
        await prisma.userMemoryCandidate.update({
          where: { id: c.id },
          data: {
            status: "approved",
            approvedAt: new Date(),
            hindsightMemoryId,
          },
        });
        retained += 1;
      } catch (err) {
        failed += 1;
        logger.warn("[digital-twin] retain failed for candidate", {
          userId,
          subsystem,
          candidateId: c.id,
          err: errMsg(err),
        });
      }
    }
    logger.info("[digital-twin] cluster approve complete", {
      userId,
      subsystem,
      retained,
      failed,
    });
  });
}));

// ── 6. Per-candidate edit / approve / reject ───────────────────────────────

digitalTwinRouter.patch("/candidates/:id", requireUserAuth, guarded("[digital-twin] PATCH /candidates/:id failed", async (req, res, userId) => {
  const id = String(req.params["id"]);
  const body = (req.body ?? {}) as { editedText?: string; status?: string };

  // Per-user privacy gate: fetch with the userId filter so a guessed ID
  // belonging to another user fails the lookup.
  const candidate = await prisma.userMemoryCandidate.findFirst({
    where: { id, userId },
  });
  if (!candidate) {
    res.status(404).json({ success: false, error: "Candidate not found" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.editedText === "string") {
    updates["editedText"] = body.editedText;
  }

  let hindsightMemoryId: string | null = candidate.hindsightMemoryId ?? null;
  if (body.status === "approved" && candidate.status === "pending") {
    const content = typeof body.editedText === "string" ? body.editedText : candidate.text;
    try {
      await ensureTwinBank();
      hindsightMemoryId = await retainTwinMemory({
        userId,
        subsystem: candidate.subsystem,
        content,
        sourceRefs: candidate.sourceRefs,
        pipelineEventId: candidate.pipelineEventId,
      });
    } catch (err) {
      logger.warn("[digital-twin] retain failed on patch-approve", {
        userId,
        candidateId: id,
        err: errMsg(err),
      });
      res.status(500).json({ success: false, error: "Retain failed" });
      return;
    }
    updates["status"] = "approved";
    updates["approvedAt"] = new Date();
    updates["hindsightMemoryId"] = hindsightMemoryId;
  } else if (body.status === "rejected" && candidate.status === "pending") {
    updates["status"] = "rejected";
    updates["rejectedAt"] = new Date();
  }

  const updated = await prisma.userMemoryCandidate.update({ where: { id }, data: updates });
  res.json({ success: true, data: { id: updated.id, status: updated.status, hindsightMemoryId } });
}));

// ── 7. Approval metrics ────────────────────────────────────────────────────

function sourceCategory(source: string): "daily" | "upload" | "backfill" | "other" {
  if (source.startsWith("daily:")) return "daily";
  if (source.startsWith("upload:")) return "upload";
  if (source.startsWith("backfill:")) return "backfill";
  return "other";
}

digitalTwinRouter.get("/metrics", requireUserAuth, guarded("[digital-twin] GET /metrics failed", async (req, res, userId) => {
  // Optional ?days=7|30|90 window applied to approvedAt/rejectedAt.
  // Pending candidates are always counted from createdAt regardless of window.
  const daysParam = Number(req.query["days"]);
  const since = !isNaN(daysParam) && daysParam > 0
    ? new Date(Date.now() - daysParam * 24 * 60 * 60 * 1000)
    : null;
  // Previous period of same length (for trend deltas)
  const prevWindow = since
    ? { gte: new Date(since.getTime() - daysParam * 24 * 60 * 60 * 1000), lt: since }
    : null;
  const prevCount = (where: Prisma.UserMemoryCandidateWhereInput) =>
    prevWindow ? prisma.userMemoryCandidate.count({ where: { userId, ...where } }) : Promise.resolve(null);

  const reviewedFilter = since ? { gte: since } : undefined;
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    approvedClean, approvedEdited, rejected, pending,
    bySubsystemRaw, bySourceRaw, oldestPending, addedSinceYesterday,
    prevApproved, prevRejected, prevApprovedEdited,
    recallSessionIds,
  ] = await Promise.all([
    prisma.userMemoryCandidate.count({ where: { userId, status: "approved", editedText: null, ...(reviewedFilter ? { approvedAt: reviewedFilter } : {}) } }),
    prisma.userMemoryCandidate.count({ where: { userId, status: "approved", NOT: { editedText: null }, ...(reviewedFilter ? { approvedAt: reviewedFilter } : {}) } }),
    prisma.userMemoryCandidate.count({ where: { userId, status: "rejected", ...(reviewedFilter ? { rejectedAt: reviewedFilter } : {}) } }),
    prisma.userMemoryCandidate.count({ where: { userId, status: "pending" } }),
    // Subsystem breakdown
    prisma.userMemoryCandidate.groupBy({
      by: ["subsystem", "status"],
      where: { userId, ...(reviewedFilter ? {
        OR: [
          { status: "approved", approvedAt: reviewedFilter },
          { status: "rejected", rejectedAt: reviewedFilter },
          { status: "pending" },
        ],
      } : {}) },
      _count: { id: true },
    }),
    // Source breakdown
    prisma.userMemoryCandidate.groupBy({
      by: ["source", "status"],
      where: { userId, ...(reviewedFilter ? {
        OR: [
          { status: "approved", approvedAt: reviewedFilter },
          { status: "rejected", rejectedAt: reviewedFilter },
        ],
      } : { status: { in: ["approved", "rejected"] } }) },
      _count: { id: true },
    }),
    // Oldest pending candidate
    prisma.userMemoryCandidate.findFirst({
      where: { userId, status: "pending" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    // Candidates added in the last 24h
    prisma.userMemoryCandidate.count({ where: { userId, createdAt: { gte: yesterday } } }),
    // Previous period approved
    prevCount({ status: "approved", approvedAt: prevWindow }),
    prevCount({ status: "rejected", rejectedAt: prevWindow }),
    prevCount({ status: "approved", NOT: { editedText: null }, approvedAt: prevWindow }),
    // Recall precision: sessionIds where Digital Twin recalled personal memories
    prisma.memoryRecallHit.findMany({
      where: { userId, agentSlug: "digital-twin", scope: "user", ...(reviewedFilter ? { recalledAt: reviewedFilter } : {}) },
      select: { sessionId: true },
      distinct: ["sessionId"],
    }),
  ]);

  // Subsystem map
  const subsystemMap: Record<string, Record<string, number>> = {};
  for (const row of bySubsystemRaw) {
    addStatusCount((subsystemMap[row.subsystem] ??= { approved: 0, rejected: 0, pending: 0 }), row.status, row._count.id);
  }
  const bySubsystem = Object.entries(subsystemMap).map(([subsystem, counts]) => ({ subsystem, ...counts }));

  // Source map
  const sourceMap: Record<string, Record<string, number>> = {};
  for (const row of bySourceRaw) {
    addStatusCount((sourceMap[sourceCategory(row.source)] ??= { approved: 0, rejected: 0 }), row.status, row._count.id);
  }
  const bySource = Object.entries(sourceMap).map(([source, counts]) => ({ source, ...counts }));

  const totalApproved = approvedClean + approvedEdited;
  const totalReviewed = totalApproved + rejected;
  const approvalRate = totalReviewed > 0 ? Math.round((totalApproved / totalReviewed) * 100) : null;
  const editRate = totalApproved > 0 ? Math.round((approvedEdited / totalApproved) * 100) : null;

  // Previous period rates
  const prevTotalReviewed = prevApproved !== null && prevRejected !== null ? prevApproved + prevRejected : null;
  const prevApprovalRate = prevApproved !== null && prevTotalReviewed !== null && prevTotalReviewed > 0
    ? Math.round((prevApproved / prevTotalReviewed) * 100)
    : null;
  const prevEditRate = prevApproved !== null && prevApproved > 0 && prevApprovedEdited !== null
    ? Math.round((prevApprovedEdited / prevApproved) * 100)
    : null;

  // Oldest pending age in days
  const oldestPendingDays = oldestPending
    ? Math.floor((Date.now() - oldestPending.createdAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Recall precision: of Digital Twin runs that recalled personal memories AND were rated,
  // what % got a thumbs-up? Uses AgentRun.rating which is set by the user in chat.
  let recallPrecision: number | null = null;
  let recallRatedCount = 0;
  if (recallSessionIds.length > 0) {
    const sessionIds = recallSessionIds.map((r) => r.sessionId);
    const [ratedRuns, positiveRuns] = await Promise.all([
      prisma.agentRun.count({ where: { sessionId: { in: sessionIds }, rating: { not: null } } }),
      prisma.agentRun.count({ where: { sessionId: { in: sessionIds }, rating: "up" } }),
    ]);
    recallRatedCount = ratedRuns;
    recallPrecision = ratedRuns > 0 ? Math.round((positiveRuns / ratedRuns) * 100) : null;
  }

  res.json({
    success: true,
    data: {
      total: totalApproved + rejected + pending,
      approvedClean,
      approvedEdited,
      totalApproved,
      rejected,
      pending,
      approvalRate,
      editRate,
      previousApprovalRate: prevApprovalRate,
      previousEditRate: prevEditRate,
      bySubsystem,
      bySource,
      oldestPendingDays,
      addedSinceYesterday,
      // Three new metrics
      recallPrecision,
      recallRatedCount,
    },
  });
}));

// ── 8. Settings (per-user Twin config) ─────────────────────────────────────
//
// Returns the persisted values on every write so the client can confirm the
// round-trip.

const MAX_SUFFIX_LEN = 500;

/** The trimmed, lower-cased `raw` when it is one of `allowed`, else null. */
function parseEnum<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  const value = String(raw ?? "").trim().toLowerCase();
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

digitalTwinRouter.patch("/settings", requireUserAuth, guarded("[digital-twin] PATCH /settings failed", async (req, res, userId) => {
  const body = (req.body ?? {}) as {
    responseSuffix?: string | null;
    memoryApprovalMode?: string;
    memoryAutoApproveMinScore?: number | string | null;
    respondPolicy?: string;
  };

  if (!["responseSuffix", "memoryApprovalMode", "memoryAutoApproveMinScore", "respondPolicy"].some((k) => k in body)) {
    res.status(400).json({ success: false, error: "At least one setting is required" });
    return;
  }

  const data: Prisma.UserUpdateInput = {};

  // Normalize: trim, accept empty string OR null as "clear suffix".
  if ("responseSuffix" in body) {
    const raw = body.responseSuffix;
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (trimmed.length > MAX_SUFFIX_LEN) {
      res.status(400).json({ success: false, error: `responseSuffix must be ≤ ${MAX_SUFFIX_LEN} chars` });
      return;
    }
    data.digitalTwinResponseSuffix = trimmed || null;
  }

  if ("memoryApprovalMode" in body) {
    const mode = parseEnum(body.memoryApprovalMode, ["manual", "auto"]);
    if (!mode) {
      res.status(400).json({ success: false, error: "memoryApprovalMode must be manual or auto" });
      return;
    }
    data.digitalTwinMemoryApprovalMode = mode;
  }

  if ("memoryAutoApproveMinScore" in body) {
    const score = Number(body.memoryAutoApproveMinScore ?? DEFAULT_AUTO_APPROVE_MIN_SCORE);
    if (!Number.isFinite(score) || score < MIN_AUTO_APPROVE_SCORE || score > MAX_AUTO_APPROVE_SCORE) {
      res.status(400).json({ success: false, error: `memoryAutoApproveMinScore must be between ${MIN_AUTO_APPROVE_SCORE} and ${MAX_AUTO_APPROVE_SCORE}` });
      return;
    }
    data.digitalTwinMemoryAutoApproveMinScore = score;
  }

  if ("respondPolicy" in body) {
    const policy = parseEnum(body.respondPolicy, ["always", "learned"]);
    if (!policy) {
      res.status(400).json({ success: false, error: "respondPolicy must be always or learned" });
      return;
    }
    data.digitalTwinRespondPolicy = policy;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      digitalTwinResponseSuffix: true,
      digitalTwinMemoryApprovalMode: true,
      digitalTwinMemoryAutoApproveMinScore: true,
      digitalTwinRespondPolicy: true,
    },
  });

  res.json({
    success: true,
    data: {
      responseSuffix: updated.digitalTwinResponseSuffix ?? "",
      memoryApprovalMode: updated.digitalTwinMemoryApprovalMode,
      memoryAutoApproveMinScore: updated.digitalTwinMemoryAutoApproveMinScore,
      respondPolicy: updated.digitalTwinRespondPolicy,
    },
  });
}));

// ── 9. .md upload (manual seed memories) ───────────────────────────────────

digitalTwinRouter.post("/upload-md", requireUserAuth, guarded("[digital-twin] /upload-md failed", async (req, res, userId) => {
  const body = (req.body ?? {}) as { filename?: string; content?: string };
  const filename = (body.filename ?? "").trim();
  const content = (body.content ?? "").trim();
  if (!filename || !content) {
    res.status(400).json({ success: false, error: "filename and content are required" });
    return;
  }
  if (content.length > 200_000) {
    res.status(413).json({ success: false, error: "Content exceeds 200 KB limit" });
    return;
  }

  // Run the same curator on the .md body so the user gets cluster-tagged
  // memories rather than one giant blob. Treat the upload as a single
  // "canvas" record sourced from the user themselves.
  const ts = new Date().toISOString();
  const inserted = await curateAndPersistBatch({
    userId,
    window: { from: new Date(ts), to: new Date(ts) },
    records: [
      {
        id: `upload:${filename}`,
        type: "canvas",
        ts,
        title: filename,
        text: content.slice(0, 50_000),
      },
    ],
    source: `upload:${filename}`,
  });

  res.json({ success: true, data: { filename, candidatesCreated: inserted } });
}));

// ── 10. Pipeline observability feed ────────────────────────────────────────
//
// Per-user event feed for the pipeline viewer. Every curator invocation writes
// one DigitalTwinPipelineEvent; these two endpoints page the feed and expose
// the fed records + full LLM trace on demand. Scoped to the requesting user —
// the detail route 404s when the row belongs to another user.

digitalTwinRouter.get("/pipeline/events", requireUserAuth, guarded("[digital-twin] GET /pipeline/events failed", async (req, res, userId) => {
  const rawLimit = Number(req.query["limit"]);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), PIPELINE_EVENTS_MAX_LIMIT)
    : PIPELINE_EVENTS_DEFAULT_LIMIT;

  const where: Prisma.DigitalTwinPipelineEventWhereInput = { userId };

  // Cursor: ISO createdAt of the last event on the previous page.
  const beforeStr = typeof req.query["before"] === "string" ? req.query["before"] : "";
  if (beforeStr) {
    const before = new Date(beforeStr);
    if (!Number.isNaN(before.getTime())) where["createdAt"] = { lt: before };
  }

  const runType = typeof req.query["runType"] === "string" ? req.query["runType"] : "";
  if (["backfill", "daily", "upload", "twin-approval", "synthesize", "gate"].includes(runType)) {
    where["runType"] = runType;
  }
  const status = typeof req.query["status"] === "string" ? req.query["status"] : "";
  if (["ok", "empty", "error", "running", "retry"].includes(status)) {
    where["status"] = status;
  }
  const sourceKind = typeof req.query["sourceKind"] === "string" ? req.query["sourceKind"] : "";
  if ((BACKFILL_SOURCES as readonly string[]).includes(sourceKind)) {
    where["sourceKind"] = sourceKind;
  }

  const rows = await prisma.digitalTwinPipelineEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, createdAt: true, runType: true, source: true, sourceKind: true,
      windowFrom: true, windowTo: true, status: true, recordCount: true,
      existingMemoryCount: true, emittedCount: true, keptCount: true,
      candidatesCreated: true, autoApproved: true, durationMs: true,
      error: true, trace: true,
    },
  });

  // Live per-event approval outcome. Candidates link to their event via
  // pipelineEventId, so "accepted" (approved now) changes as the user
  // approves/rejects — unlike the static emittedCount / candidatesCreated.
  const eventIds = rows.map((r) => r.id);
  const statusGroups = eventIds.length === 0 ? [] : await prisma.userMemoryCandidate.groupBy({
    by: ["pipelineEventId", "status"],
    where: { pipelineEventId: { in: eventIds } },
    _count: { _all: true },
  });
  const outcomeByEvent = new Map<string, Record<string, number>>();
  for (const g of statusGroups) {
    if (!g.pipelineEventId) continue;
    const o = outcomeByEvent.get(g.pipelineEventId) ?? { approved: 0, pending: 0, rejected: 0 };
    addStatusCount(o, g.status, g._count._all);
    outcomeByEvent.set(g.pipelineEventId, o);
  }

  const events = rows.map((r) => {
    const o = outcomeByEvent.get(r.id);
    return {
      ...toEventSummary(r),
      approvedCount: o?.approved ?? 0,
      pendingCount: o?.pending ?? 0,
      rejectedCount: o?.rejected ?? 0,
    };
  });
  const nextBefore = events.length === limit ? rows[rows.length - 1]!.createdAt.toISOString() : null;

  res.json({ success: true, data: { events, nextBefore } });
}));

// Re-run one pipeline event's window. Only for runs that produced nothing —
// an "ok" run already created candidates, so re-running it would duplicate them.
// Fetch + LLM distill takes minutes, so this returns 202 and the work continues
// in the background, writing its own events that the feed picks up.
digitalTwinRouter.post("/pipeline/events/:id/retry", requireUserAuth, guarded("[digital-twin] POST /pipeline/events/:id/retry failed", async (req, res, userId) => {
  const eventId = String(req.params["id"] ?? "");
  const event = await prisma.digitalTwinPipelineEvent.findFirst({
    where: { id: eventId, userId },
    select: { id: true, sourceKind: true, status: true, windowFrom: true, windowTo: true },
  });
  if (!event) {
    res.status(404).json({ success: false, error: "Event not found" });
    return;
  }
  // upload / twin-approval / synthesize runs have no source window to re-walk.
  if (!event.sourceKind) {
    res.status(400).json({ success: false, error: "This run has no source window to retry" });
    return;
  }
  if (event.status !== "error" && event.status !== "empty") {
    res.status(400).json({ success: false, error: "Only failed or empty runs can be retried" });
    return;
  }
  if (inFlightRetry.has(eventId)) {
    res.status(202).json({ success: true, data: { status: "already-running" } });
    return;
  }

  res.status(202).json({ success: true, data: { status: "started" } });

  const kind = event.sourceKind as BackfillSource;
  const window = { from: event.windowFrom, to: event.windowTo };
  const source = `retry:${new Date().toISOString().slice(0, 10)}:${kind}`;

  inBackground(inFlightRetry, eventId, async () => {
    try {
      const records = await fetchSourceRecords(kind, userId, window);

      if (records.length === 0) {
        // Still empty. Record it so the feed shows the retry happened and
        // the window is genuinely bare, not that the button did nothing.
        await recordPipelineEvent({ userId, source, window, status: "empty", recordCount: 0 });
        return;
      }
      await curateRecordsInBatches({ userId, window, records, source });
    } catch (err) {
      const message = errMsg(err);
      logger.warn("[digital-twin] pipeline retry failed", { userId, eventId, err: message });
      await recordPipelineEvent({ userId, source, window, status: "error", recordCount: 0, error: message });
    }
  });
}));

digitalTwinRouter.get("/pipeline/events/:id", requireUserAuth, guarded("[digital-twin] GET /pipeline/events/:id failed", async (req, res, userId) => {
  const id = String(req.params["id"]);

  const row = await prisma.digitalTwinPipelineEvent.findUnique({ where: { id } });

  // 404 when missing OR owned by another user (same privacy gate as the
  // per-candidate routes — never leak another user's pipeline data).
  if (!row || row.userId !== userId) {
    res.status(404).json({ success: false, error: "Event not found" });
    return;
  }

  res.json({
    success: true,
    data: {
      ...toEventSummary(row),
      records: (row.records ?? null) as unknown,
      trace: (row.trace ?? null) as UserMemoryCuratorTrace | null,
    },
  });
}));
