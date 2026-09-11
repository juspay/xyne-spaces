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
 *   5. The Digital Twin agent (slug=`assistant`) recalls only `user:<userId>`
 *      tagged memories — enforced server-side in memory-search.ts (claw).
 */

import { Router, type Request } from "express";
import { errMsg } from "../lib/errors.js";
import { Prisma } from "@prisma/client";
import { bankIdForAgent, getMemoryProvider } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { createLogger, createTraceId } from "../logger.js";
import { requireUserAuth } from "../middleware/require-auth.js";
import {
  countUserRecords,
  fetchUserCalls,
  fetchUserCanvases,
  fetchUserMessages,
} from "../services/userMemoryFetcher.js";
import { assembleConversationUnits, isContextAssemblerEnabled } from "../services/contextAssembler.js";
import { packRecordsIntoBatches } from "../services/userMemoryBatcher.js";
import { recordPipelineEvent } from "../services/digitalTwinPipelineEvents.js";
import {
  curateAndPersistBatch,
  ensureTwinBank,
  pickEventTimestamp,
  twinObservationScopes,
} from "../services/userMemoryCuratorClient.js";
import {
  TWIN_AGENT_SLUG,
  MAX_FILE_CHARS,
  MAX_LOADED_FILES,
  ensureDefaultFiles,
  listFiles,
  upsertFile,
  setLoadInPrompt,
  deleteFile,
  MaxLoadedFilesError,
} from "../services/agentMemoryFiles.js";
import { synthesizeSoulFilesForUser } from "../services/twinSoulSynthesizer.js";
import {
  cancelDigitalTwinBackfill,
  enqueueDigitalTwinBackfill,
  getBackfillQueue,
  backfillJobIsLive,
  type BackfillSource,
} from "../queue/digital-twin-backfill-queue.js";
import {
  summarizeBackfillState,
  applyBackfillPause,
  collectAndClearResumable,
  type BackfillState,
  type BackfillJobProbe,
} from "../services/backfillStatus.js";
import type { UserMemoryCuratorTrace } from "xyne-claw-shared";

const logger = createLogger("digital-twin", createTraceId());
const memory = getMemoryProvider();

/** Hindsight bank for the dedicated Digital Twin agent. Separate from the
 *  default 'assistant' agent's bank — Twin user memories live in their own
 *  namespace, segregated per-user via the `user:<id>` tag. Wiping or
 *  recreating Twin data never touches assistant memories and vice versa. */
const TWIN_BANK_ID = bankIdForAgent("digital-twin");

/** Hard limits on backfill window (user can pick anything between these). */
const MAX_BACKFILL_MONTHS = 24;
const MIN_BACKFILL_MONTHS = 0;

/** Per-record curator cost estimate. Haiku 4.5 at ~$0.001 per request for
 *  a 50-record batch ≈ $0.000020 per record. Used for the consent screen. */
const COST_PER_RECORD_USD = 0.000020;
const DEFAULT_AUTO_APPROVE_MIN_SCORE = 0.9;
const MIN_AUTO_APPROVE_SCORE = 0.7;
const MAX_AUTO_APPROVE_SCORE = 1;

/** Per-record fact density coefficient. Heuristic — gets refined over time. */
const CANDIDATES_PER_RECORD = 0.06;

/** Sources the backfill walks (one BullMQ job per source per user). */
const BACKFILL_SOURCES: readonly BackfillSource[] = ["messages", "calls", "canvases"];

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

export const digitalTwinRouter = Router();

function getUserId(req: Request): string | null {
  const v = req.headers["x-user-id"];
  if (typeof v !== "string" || v.length === 0) return null;
  return v;
}

// ── Backfill status normalization ──────────────────────────────────────────

/** How long without a progress heartbeat before a running backfill is stalled. */
const BACKFILL_STALL_MS = 120_000;

/** Best-effort BullMQ probe. Any error (queue down, missing job) → null. */
async function probeBackfillJob(userId: string, source: BackfillSource): Promise<BackfillJobProbe | null> {
  try {
    const job = await getBackfillQueue().getJob(`dt-backfill:${userId}:${source}`);
    if (!job) return null;
    const state = await job.getState();
    return {
      state,
      attemptsMade: job.attemptsMade,
      maxAttempts: (job.opts?.attempts as number | undefined) ?? 5,
      failedReason: job.failedReason ?? null,
    };
  } catch {
    return null;
  }
}

/** Build the normalized `data.backfill` block from raw backfillState. Returns
 *  null when there's no state at all. Existing backfillState is left untouched
 *  by callers — this is purely additive. The running/paused/stalled math lives
 *  in the pure, unit-tested `summarizeBackfillState`. */
async function buildBackfillBlock(userId: string, raw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== "object") return null;
  const state = raw as BackfillState;
  const probeEntries = await Promise.all(
    BACKFILL_SOURCES.map(async (s) => [s, state[s] ? await probeBackfillJob(userId, s) : null] as const),
  );
  const probes = Object.fromEntries(probeEntries) as Partial<Record<BackfillSource, BackfillJobProbe | null>>;
  return summarizeBackfillState(state, probes, { nowMs: Date.now(), stallMs: BACKFILL_STALL_MS });
}

// ── Pipeline events normalization ──────────────────────────────────────────

const PIPELINE_EVENTS_DEFAULT_LIMIT = 50;
const PIPELINE_EVENTS_MAX_LIMIT = 200;

interface PipelineEventRow {
  id: string;
  createdAt: Date;
  runType: string;
  source: string;
  sourceKind: string | null;
  windowFrom: Date;
  windowTo: Date;
  status: string;
  recordCount: number;
  existingMemoryCount: number;
  emittedCount: number;
  keptCount: number;
  candidatesCreated: number;
  autoApproved: number;
  durationMs: number;
  error: string | null;
  trace: unknown;
  records?: unknown;
}

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

digitalTwinRouter.get("/status", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    const user = await (prisma.user.findUnique as any)({
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
        const page = await memory.listMemories(TWIN_BANK_ID, { tags: [`user:${userId}`], limit: wide });
        memoryCount = page.memories.filter((m) => (m.tags ?? []).includes(`user:${userId}`)).length;
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
  } catch (err) {
    logger.error("[digital-twin] /status failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ── 2. Estimate (consent-screen support) ───────────────────────────────────

digitalTwinRouter.get("/estimate", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
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
  } catch (err) {
    logger.error("[digital-twin] /estimate failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ── 3. Enable ──────────────────────────────────────────────────────────────

digitalTwinRouter.post("/enable", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    const body = (req.body ?? {}) as { backfill?: { from?: string; to?: string } | null };
    const now = new Date();
    let backfillState: Record<string, unknown> | null = null;
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
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
        res.status(400).json({ success: false, error: "Invalid backfill range" });
        return;
      }
      const monthsBack = (to.getTime() - from.getTime()) / (30 * 24 * 3600 * 1000);
      if (monthsBack < MIN_BACKFILL_MONTHS || monthsBack > MAX_BACKFILL_MONTHS) {
        res.status(400).json({ success: false, error: `Backfill must span ≤ ${MAX_BACKFILL_MONTHS} months` });
        return;
      }
      backfillState = {};
      // ceil((to-from)/30d), min 1 — mirrors the worker's windowsTotalFor so
      // the UI's total agrees with the number of windows the walk will run.
      const spanMs = to.getTime() - from.getTime();
      const windowsTotal = Math.max(1, Math.ceil(spanMs / (30 * 24 * 3600 * 1000)));
      const nowIso = now.toISOString();
      for (const s of BACKFILL_SOURCES) {
        backfillState[s] = {
          from: from.toISOString(),
          to: to.toISOString(),
          // Chronological walk (oldest → newest): cursor is the LOWER bound of
          // the next chunk, seeded at `from`. See the backfill worker.
          cursor: from.toISOString(),
          complete: false,
          // Fresh progress on every (re-)enable so old counts never carry over.
          progress: {
            windowsTotal,
            windowsDone: 0,
            recordsSeen: 0,
            candidatesMade: 0,
            currentWindow: null,
            lastError: null,
            startedAt: nowIso,
            updatedAt: nowIso,
          },
        };
      }
    }

    // Always write the new backfillState (or null if no backfill requested).
    // If we conditionally skipped the field on null, a re-enable that opts
    // out of backfill would inherit the previous run's stale state and the
    // worker would think the new walk was "already complete".
    await prisma.user.update({
      where: { id: userId },
      data: {
        digitalTwinEnabled: true,
        digitalTwinEnabledAt: now,
        digitalTwinBackfillState: backfillState
          ? (backfillState as unknown as Prisma.InputJsonValue)
          : (Prisma.JsonNull as unknown as Prisma.NullableJsonNullValueInput),
      },
    });

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

    const backfillJobIds: string[] = [];
    if (from && to) {
      for (const source of BACKFILL_SOURCES) {
        const jobId = await enqueueDigitalTwinBackfill({ userId, source, from, to });
        backfillJobIds.push(jobId);
      }
    }

    res.json({
      success: true,
      data: {
        enabled: true,
        enabledAt: now,
        backfillJobIds,
      },
    });
  } catch (err) {
    logger.error("[digital-twin] /enable failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ── 3b. Pause / Resume backfill ─────────────────────────────────────────────
// Stop the in-flight backfill walk WITHOUT losing progress, and resume it later
// from the exact cursor. Distinct from /disable (which turns the Twin off and
// clears state): pause keeps the Twin enabled and the state intact.

digitalTwinRouter.post("/backfill/pause", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { digitalTwinBackfillState: true },
    });
    const raw = user?.digitalTwinBackfillState as unknown;
    if (!raw || typeof raw !== "object") {
      res.json({ success: true, data: { paused: false, pausedSources: 0, cancelledJobs: 0, message: "No backfill in progress" } });
      return;
    }
    // Remove the in-flight BullMQ jobs so the worker stops walking. The cursor
    // already persisted on the state is the resume point.
    const cancelledJobs = await cancelDigitalTwinBackfill(userId);
    const state = raw as BackfillState;
    const pausedSources = applyBackfillPause(state, new Date().toISOString());
    await prisma.user.update({
      where: { id: userId },
      data: { digitalTwinBackfillState: state as unknown as Prisma.InputJsonValue },
    });
    logger.info("[digital-twin] backfill paused", { userId, pausedSources, cancelledJobs });
    res.json({ success: true, data: { paused: pausedSources > 0, pausedSources, cancelledJobs } });
  } catch (err) {
    logger.error("[digital-twin] /backfill/pause failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

digitalTwinRouter.post("/backfill/resume", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { digitalTwinEnabled: true, digitalTwinBackfillState: true },
    });
    if (!user?.digitalTwinEnabled) {
      res.status(400).json({ success: false, error: "Digital Twin is not enabled" });
      return;
    }
    const raw = user.digitalTwinBackfillState as unknown;
    if (!raw || typeof raw !== "object") {
      res.json({ success: true, data: { resumed: 0, jobIds: [], message: "No backfill to resume" } });
      return;
    }
    const state = raw as BackfillState;
    // Clear pausedAt on incomplete sources FIRST and persist, so any job still
    // finishing its current window (BullMQ can't stop an active job — it stops
    // itself at the next window check) sees the un-pause and simply continues.
    const resumable = collectAndClearResumable(state);
    await prisma.user.update({
      where: { id: userId },
      data: { digitalTwinBackfillState: state as unknown as Prisma.InputJsonValue },
    });
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
  } catch (err) {
    logger.error("[digital-twin] /backfill/resume failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ── 4. Disable ─────────────────────────────────────────────────────────────

// ─── Memory files (Memory v2 — deterministic, file-based persona) ─────────
// Named documents (soul.md, people.md, …) the twin always loads. Up to
// MAX_LOADED_FILES are injected into the system prompt, each ≤ MAX_FILE_CHARS.

const MEMORY_FILE_NAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;

digitalTwinRouter.get("/memory-files", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    // Make sure a returning user who enabled before this feature still gets the
    // default structure.
    await ensureDefaultFiles(TWIN_AGENT_SLUG, userId).catch(() => {});
    const files = await listFiles(TWIN_AGENT_SLUG, userId);
    res.json({
      success: true,
      data: { files, maxLoaded: MAX_LOADED_FILES, maxChars: MAX_FILE_CHARS },
    });
  } catch (err) {
    logger.error("[digital-twin] list memory-files failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

digitalTwinRouter.put("/memory-files/:name", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
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
      userId,
      name,
      content: body.content,
      updatedBy: "user",
    });
    res.json({ success: true, data: { file, truncated: overCap, maxChars: MAX_FILE_CHARS } });
  } catch (err) {
    logger.error("[digital-twin] put memory-file failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

digitalTwinRouter.post("/memory-files/:name/load", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
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
    logger.error("[digital-twin] toggle memory-file load failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

digitalTwinRouter.delete("/memory-files/:name", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    const name = String(req.params.name ?? "");
    const deleted = await deleteFile(TWIN_AGENT_SLUG, userId, name);
    res.json({ success: true, data: { deleted } });
  } catch (err) {
    logger.error("[digital-twin] delete memory-file failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// Rebuild the persona files from approved memories (soul synthesizer, Phase 4).
// N LLM calls (~30-60s) → runs in the background, returns 202. The client
// re-fetches /memory-files after a short delay to see the result.
digitalTwinRouter.post("/synthesize", requireUserAuth, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Unauthenticated" });
    return;
  }
  if (inFlightSynth.has(userId)) {
    res.status(202).json({ success: true, data: { status: "already-running" } });
    return;
  }
  inFlightSynth.add(userId);
  res.status(202).json({ success: true, data: { status: "started" } });
  setImmediate(async () => {
    try {
      await synthesizeSoulFilesForUser(userId, "manual");
    } catch (err) {
      logger.warn("[digital-twin] synthesize failed", { userId, err: errMsg(err) });
    } finally {
      inFlightSynth.delete(userId);
    }
  });
});

// Manually delete the user's stored twin memories — ALL, or a created-date
// RANGE. Runs in the background (Hindsight invalidations are slow HTTP calls);
// responds 202 and the client polls /status (memoryDeleteInProgress + the
// dropping memoryCount) for a live indicator. Used to wipe + re-backfill clean.
digitalTwinRouter.post("/memories/delete", requireUserAuth, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Unauthenticated" });
    return;
  }
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
  inFlightMemDelete.add(userId);
  res.status(202).json({ success: true, data: { deleting: true, mode } });

  setImmediate(async () => {
    const userTag = `user:${userId}`;
    let deleted = 0;
    let candidatesDeleted = 0;
    try {
      if (mode === "all") {
        deleted = (await memory.deleteByTag?.(TWIN_BANK_ID, userTag)) ?? 0;
        candidatesDeleted = (await prisma.userMemoryCandidate.deleteMany({ where: { userId } })).count;
      } else {
        // Range: list the user's memories, keep those whose createdAt is in
        // [from,to], invalidate each. Re-filter by the user tag (Hindsight
        // over-matches tag queries — authoritative gate).
        const page = await memory.listMemories(TWIN_BANK_ID, { tags: [userTag], limit: 1000 });
        const targets = page.memories
          .filter((m) => (m.tags ?? []).includes(userTag))
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
            await memory.deleteMemory(TWIN_BANK_ID, m.id);
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
    } finally {
      inFlightMemDelete.delete(userId);
    }
  });
});

digitalTwinRouter.post("/disable", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    const { deleteMemories } = (req.body ?? {}) as { deleteMemories?: boolean };

    // Cancel in-flight backfill jobs first — otherwise they'll keep walking
    // history and writing candidates after the user opted out, costing LLM
    // budget for work that will sit in the review queue unwanted.
    const cancelledJobs = await cancelDigitalTwinBackfill(userId);

    // Clear backfillState alongside the flag. If we left stale state, a
    // future re-enable would have the worker think the previous walk was
    // already complete and skip the new range.
    await prisma.user.update({
      where: { id: userId },
      data: {
        digitalTwinEnabled: false,
        digitalTwinBackfillState: Prisma.JsonNull as unknown as Prisma.NullableJsonNullValueInput,
      },
    });

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
    inFlightDisables.add(userId);

    res.status(202).json({
      success: true,
      data: { disabled: true, deleting: true, cancelledJobs },
    });

    setImmediate(async () => {
      let deletedHindsight = 0;
      let deletedCandidates = 0;
      try {
        // Delete the user's memories from Hindsight by TAG, not by stored id.
        // candidate.hindsightMemoryId is always null (async retain returns no
        // ids — see the digital-twin memory investigation), so the old per-id
        // delete silently removed nothing. Tag delete reaches every memory the
        // user has in the shared twin bank.
        try {
          deletedHindsight = (await memory.deleteByTag?.(TWIN_BANK_ID, `user:${userId}`)) ?? 0;
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
      } finally {
        inFlightDisables.delete(userId);
      }
    });
  } catch (err) {
    logger.error("[digital-twin] /disable failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

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
digitalTwinRouter.get("/graph", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    if (typeof memory.getMemoryGraph !== "function") {
      res.json({ success: true, data: { nodes: [], edges: [] } });
      return;
    }
    const userTag = `user:${userId}`;
    const graph = await memory.getMemoryGraph(TWIN_BANK_ID, { tags: [userTag], limit: 2000 });
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
  } catch (err) {
    logger.error("[digital-twin] /graph failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ── 5. Clusters (grouped pending view) ─────────────────────────────────────

digitalTwinRouter.get("/clusters", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }

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
  } catch (err) {
    logger.error("[digital-twin] /clusters failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

digitalTwinRouter.get("/clusters/:subsystem", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    const subsystem = String(req.params["subsystem"]);
    const candidates = await prisma.userMemoryCandidate.findMany({
      where: { userId, subsystem, status: { in: ["pending"] } },
      orderBy: { signalScore: "desc" },
      take: 200,
    });
    res.json({ success: true, data: { subsystem, candidates } });
  } catch (err) {
    logger.error("[digital-twin] /clusters/:subsystem failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ── 6. Cluster batch-approve ───────────────────────────────────────────────

digitalTwinRouter.post("/clusters/:subsystem/approve", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
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
    inFlightClusterApprovals.add(lockKey);

    res.status(202).json({
      success: true,
      data: { processing: true, count: candidates.length, subsystem },
    });

    // Background: retain each candidate to Hindsight, update row status.
    setImmediate(async () => {
      await ensureTwinBank();
      let retained = 0;
      let failed = 0;
      for (const c of candidates) {
        const content = c.editedText ?? c.text;
        const tags = [
          `user:${userId}`,
          `subsystem:${subsystem}`,
          "scope:user",
          // Trace link — see memories list. Hindsight's retain returns no id, so
          // we tag the memory with its pipeline event instead of relying on the
          // (always-null) candidate.hindsightMemoryId.
          ...(c.pipelineEventId ? [`pipeline:${c.pipelineEventId}`] : []),
        ];
        const eventTs = pickEventTimestamp(c.sourceRefs);
        try {
          const out = await memory.retain(TWIN_BANK_ID, [{
            content,
            tags,
            ...(eventTs ? { timestamp: eventTs } : {}),
            observationScopes: twinObservationScopes(userId),
          }]);
          const memoryId = out?.[0]?.id;
          await prisma.userMemoryCandidate.update({
            where: { id: c.id },
            data: {
              status: "approved",
              approvedAt: new Date(),
              hindsightMemoryId: memoryId ?? null,
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
      inFlightClusterApprovals.delete(lockKey);
    });
  } catch (err) {
    logger.error("[digital-twin] /clusters/:subsystem/approve failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ── 7. Per-candidate edit / approve / reject ───────────────────────────────

digitalTwinRouter.patch("/candidates/:id", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
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
      const tags = [
        `user:${userId}`,
        `subsystem:${candidate.subsystem}`,
        "scope:user",
        // Trace link — tag the memory with its pipeline event (candidate
        // hindsightMemoryId is unreliable; see memories list).
        ...(candidate.pipelineEventId ? [`pipeline:${candidate.pipelineEventId}`] : []),
      ];
      const eventTs = pickEventTimestamp(candidate.sourceRefs);
      try {
        await ensureTwinBank();
        const out = await memory.retain(TWIN_BANK_ID, [{
          content,
          tags,
          ...(eventTs ? { timestamp: eventTs } : {}),
          observationScopes: twinObservationScopes(userId),
        }]);
        hindsightMemoryId = out?.[0]?.id ?? null;
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
  } catch (err) {
    logger.error("[digital-twin] PATCH /candidates/:id failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ── 8. Approval metrics ────────────────────────────────────────────────────

digitalTwinRouter.get("/metrics", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }

    // Optional ?days=7|30|90 window applied to approvedAt/rejectedAt.
    // Pending candidates are always counted from createdAt regardless of window.
    const daysParam = Number(req.query["days"]);
    const since = !isNaN(daysParam) && daysParam > 0
      ? new Date(Date.now() - daysParam * 24 * 60 * 60 * 1000)
      : null;
    // Previous period of same length (for trend deltas)
    const prevSince = since && daysParam > 0
      ? new Date(since.getTime() - daysParam * 24 * 60 * 60 * 1000)
      : null;

    const reviewedFilter = since ? { gte: since } : undefined;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    function sourceCategory(source: string): "daily" | "upload" | "backfill" | "other" {
      if (source.startsWith("daily:")) return "daily";
      if (source.startsWith("upload:")) return "upload";
      if (source.startsWith("backfill:")) return "backfill";
      return "other";
    }

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
      prevSince ? prisma.userMemoryCandidate.count({ where: { userId, status: "approved", approvedAt: { gte: prevSince, lt: since! } } }) : Promise.resolve(null),
      prevSince ? prisma.userMemoryCandidate.count({ where: { userId, status: "rejected", rejectedAt: { gte: prevSince, lt: since! } } }) : Promise.resolve(null),
      prevSince ? prisma.userMemoryCandidate.count({ where: { userId, status: "approved", NOT: { editedText: null }, approvedAt: { gte: prevSince, lt: since! } } }) : Promise.resolve(null),
      // Recall precision: sessionIds where Digital Twin recalled personal memories
      prisma.memoryRecallHit.findMany({
        where: { userId, agentSlug: "digital-twin", scope: "user", ...(reviewedFilter ? { recalledAt: reviewedFilter } : {}) },
        select: { sessionId: true },
        distinct: ["sessionId"],
      }),
    ]);

    // Subsystem map
    const subsystemMap: Record<string, { approved: number; rejected: number; pending: number }> = {};
    for (const row of bySubsystemRaw) {
      const s = row.subsystem;
      if (!subsystemMap[s]) subsystemMap[s] = { approved: 0, rejected: 0, pending: 0 };
      if (row.status === "approved") subsystemMap[s].approved += row._count.id;
      else if (row.status === "rejected") subsystemMap[s].rejected += row._count.id;
      else if (row.status === "pending") subsystemMap[s].pending += row._count.id;
    }
    const bySubsystem = Object.entries(subsystemMap).map(([subsystem, counts]) => ({ subsystem, ...counts }));

    // Source map
    const sourceMap: Record<string, { approved: number; rejected: number }> = {};
    for (const row of bySourceRaw) {
      const cat = sourceCategory(row.source);
      if (!sourceMap[cat]) sourceMap[cat] = { approved: 0, rejected: 0 };
      if (row.status === "approved") sourceMap[cat].approved += row._count.id;
      else if (row.status === "rejected") sourceMap[cat].rejected += row._count.id;
    }
    const bySource = Object.entries(sourceMap).map(([source, counts]) => ({ source, ...counts }));

    const totalApproved = approvedClean + approvedEdited;
    const totalReviewed = totalApproved + rejected;
    const approvalRate = totalReviewed > 0 ? Math.round((totalApproved / totalReviewed) * 100) : null;
    const editRate = totalApproved > 0 ? Math.round((approvedEdited / totalApproved) * 100) : null;

    // Previous period rates
    const prevTotalApproved = prevApproved ?? null;
    const prevTotalReviewed = prevApproved !== null && prevRejected !== null ? prevApproved + prevRejected : null;
    const prevApprovalRate = prevTotalReviewed !== null && prevTotalReviewed > 0
      ? Math.round(((prevTotalApproved ?? 0) / prevTotalReviewed) * 100)
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
  } catch (err) {
    logger.error("[digital-twin] GET /metrics failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ── 9. Settings (per-user Twin config) ─────────────────────────────────────
//
// V1 settings surface: just the response suffix. Future fields go here too
// (e.g. response-style flags, opt-out tags). Returns the persisted value on
// every write so the client can confirm the round-trip.

const MAX_SUFFIX_LEN = 500;

digitalTwinRouter.patch("/settings", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    const body = (req.body ?? {}) as {
      responseSuffix?: string | null;
      memoryApprovalMode?: string;
      memoryAutoApproveMinScore?: number | string | null;
      respondPolicy?: string;
    };

    if (
      !("responseSuffix" in body) &&
      !("memoryApprovalMode" in body) &&
      !("memoryAutoApproveMinScore" in body) &&
      !("respondPolicy" in body)
    ) {
      res.status(400).json({ success: false, error: "At least one setting is required" });
      return;
    }

    const data: Record<string, unknown> = {};

    // Normalize: trim, accept empty string OR null as "clear suffix".
    if ("responseSuffix" in body) {
      const raw = body.responseSuffix;
      let normalized: string | null = null;
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          normalized = null;
        } else if (trimmed.length > MAX_SUFFIX_LEN) {
          res.status(400).json({ success: false, error: `responseSuffix must be ≤ ${MAX_SUFFIX_LEN} chars` });
          return;
        } else {
          normalized = trimmed;
        }
      }
      data.digitalTwinResponseSuffix = normalized;
    }

    if ("memoryApprovalMode" in body) {
      const mode = String(body.memoryApprovalMode ?? "").trim().toLowerCase();
      if (mode !== "manual" && mode !== "auto") {
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
      const policy = String(body.respondPolicy ?? "").trim().toLowerCase();
      if (policy !== "always" && policy !== "learned") {
        res.status(400).json({ success: false, error: "respondPolicy must be always or learned" });
        return;
      }
      data.digitalTwinRespondPolicy = policy;
    }

    const updated = await (prisma.user.update as any)({
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
  } catch (err) {
    logger.error("[digital-twin] PATCH /settings failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ── 9. .md upload (manual seed memories) ───────────────────────────────────

digitalTwinRouter.post("/upload-md", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
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
  } catch (err) {
    logger.error("[digital-twin] /upload-md failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ── 10. Pipeline observability feed ────────────────────────────────────────
//
// Per-user event feed for the pipeline viewer. Every curator invocation writes
// one DigitalTwinPipelineEvent; these two endpoints page the feed and expose
// the fed records + full LLM trace on demand. Scoped to the requesting user —
// the detail route 404s when the row belongs to another user.

digitalTwinRouter.get("/pipeline/events", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }

    const rawLimit = Number(req.query["limit"]);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), PIPELINE_EVENTS_MAX_LIMIT)
      : PIPELINE_EVENTS_DEFAULT_LIMIT;

    const where: Record<string, unknown> = { userId };

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
    if (["messages", "calls", "canvases"].includes(sourceKind)) {
      where["sourceKind"] = sourceKind;
    }

    const rows = await (prisma.digitalTwinPipelineEvent.findMany as any)({
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
    const eventIds = (rows as PipelineEventRow[]).map((r) => r.id);
    const statusGroups = eventIds.length === 0 ? [] : await (prisma.userMemoryCandidate.groupBy as any)({
      by: ["pipelineEventId", "status"],
      where: { pipelineEventId: { in: eventIds } },
      _count: { _all: true },
    });
    const outcomeByEvent = new Map<string, { approved: number; pending: number; rejected: number }>();
    for (const g of statusGroups as Array<{ pipelineEventId: string | null; status: string; _count: { _all: number } }>) {
      if (!g.pipelineEventId) continue;
      const o = outcomeByEvent.get(g.pipelineEventId) ?? { approved: 0, pending: 0, rejected: 0 };
      if (g.status === "approved") o.approved += g._count._all;
      else if (g.status === "pending") o.pending += g._count._all;
      else if (g.status === "rejected") o.rejected += g._count._all;
      outcomeByEvent.set(g.pipelineEventId, o);
    }

    const events = (rows as PipelineEventRow[]).map((r) => {
      const o = outcomeByEvent.get(r.id);
      return {
        ...toEventSummary(r),
        approvedCount: o?.approved ?? 0,
        pendingCount: o?.pending ?? 0,
        rejectedCount: o?.rejected ?? 0,
      };
    });
    const nextBefore =
      events.length === limit
        ? (rows[rows.length - 1].createdAt as Date).toISOString()
        : null;

    res.json({ success: true, data: { events, nextBefore } });
  } catch (err) {
    logger.error("[digital-twin] GET /pipeline/events failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// Re-run one pipeline event's window. Only for runs that produced nothing —
// an "ok" run already created candidates, so re-running it would duplicate them.
// Fetch + LLM distill takes minutes, so this returns 202 and the work continues
// in the background, writing its own events that the feed picks up.
digitalTwinRouter.post("/pipeline/events/:id/retry", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
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

    inFlightRetry.add(eventId);
    res.status(202).json({ success: true, data: { status: "started" } });

    const kind = event.sourceKind as BackfillSource;
    const window = { from: event.windowFrom, to: event.windowTo };
    const source = `retry:${new Date().toISOString().slice(0, 10)}:${kind}`;

    setImmediate(async () => {
      try {
        const records =
          kind === "calls"
            ? await fetchUserCalls(userId, window)
            : kind === "canvases"
              ? await fetchUserCanvases(userId, window)
              : isContextAssemblerEnabled()
                ? await assembleConversationUnits(userId, window)
                : await fetchUserMessages(userId, window);

        if (records.length === 0) {
          // Still empty. Record it so the feed shows the retry happened and
          // the window is genuinely bare, not that the button did nothing.
          await recordPipelineEvent({ userId, source, window, status: "empty", recordCount: 0 });
          return;
        }
        for (const batch of packRecordsIntoBatches(records)) {
          await curateAndPersistBatch({ userId, window, records: batch, source });
        }
      } catch (err) {
        const message = errMsg(err);
        logger.warn("[digital-twin] pipeline retry failed", { userId, eventId, err: message });
        await recordPipelineEvent({ userId, source, window, status: "error", recordCount: 0, error: message });
      } finally {
        inFlightRetry.delete(eventId);
      }
    });
  } catch (err) {
    logger.error("[digital-twin] POST /pipeline/events/:id/retry failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

digitalTwinRouter.get("/pipeline/events/:id", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    const id = String(req.params["id"]);

    const row = (await (prisma.digitalTwinPipelineEvent.findUnique as any)({
      where: { id },
    })) as (PipelineEventRow & { userId: string }) | null;

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
  } catch (err) {
    logger.error("[digital-twin] GET /pipeline/events/:id failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});
