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
import { Prisma } from "@prisma/client";
import { bankIdForAgent, getMemoryProvider } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { createLogger, createTraceId } from "../logger.js";
import { requireUserAuth } from "../middleware/require-auth.js";
import { countUserRecords } from "../services/userMemoryFetcher.js";
import { curateAndPersistBatch } from "../services/userMemoryCuratorClient.js";
import {
  cancelDigitalTwinBackfill,
  enqueueDigitalTwinBackfill,
  type BackfillSource,
} from "../queue/digital-twin-backfill-queue.js";

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

export const digitalTwinRouter = Router();

function getUserId(req: Request): string | null {
  const v = req.headers["x-user-id"];
  if (typeof v !== "string" || v.length === 0) return null;
  return v;
}

// ── 1. Status ──────────────────────────────────────────────────────────────

digitalTwinRouter.get("/status", requireUserAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        digitalTwinEnabled: true,
        digitalTwinEnabledAt: true,
        digitalTwinBackfillState: true,
        digitalTwinResponseSuffix: true,
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
    res.json({
      success: true,
      data: {
        enabled: user.digitalTwinEnabled,
        enabledAt: user.digitalTwinEnabledAt,
        backfillState: user.digitalTwinBackfillState ?? null,
        pendingCandidates: pending,
        totalCandidates: total,
        approvedCandidates: approved,
        mdFileCount: mdFiles,
        responseSuffix: user.digitalTwinResponseSuffix ?? "",
      },
    });
  } catch (err) {
    logger.error("[digital-twin] /status failed", { err: err instanceof Error ? err.message : String(err) });
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
    logger.error("[digital-twin] /estimate failed", { err: err instanceof Error ? err.message : String(err) });
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
      for (const s of BACKFILL_SOURCES) {
        backfillState[s] = { from: from.toISOString(), to: to.toISOString(), cursor: to.toISOString(), complete: false };
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
    logger.error("[digital-twin] /enable failed", { err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ── 4. Disable ─────────────────────────────────────────────────────────────

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
        const approved = await prisma.userMemoryCandidate.findMany({
          where: { userId, status: "approved", hindsightMemoryId: { not: null } },
          select: { hindsightMemoryId: true },
        });
        for (const a of approved) {
          if (!a.hindsightMemoryId) continue;
          try {
            await memory.deleteMemory(TWIN_BANK_ID, a.hindsightMemoryId);
            deletedHindsight += 1;
          } catch (err) {
            logger.warn("[digital-twin] hindsight delete failed on disable", {
              userId,
              memoryId: a.hindsightMemoryId,
              err: err instanceof Error ? err.message : String(err),
            });
          }
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
          err: err instanceof Error ? err.message : String(err),
        });
      } finally {
        inFlightDisables.delete(userId);
      }
    });
  } catch (err) {
    logger.error("[digital-twin] /disable failed", { err: err instanceof Error ? err.message : String(err) });
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
    logger.error("[digital-twin] /clusters failed", { err: err instanceof Error ? err.message : String(err) });
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
    logger.error("[digital-twin] /clusters/:subsystem failed", { err: err instanceof Error ? err.message : String(err) });
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
      let retained = 0;
      let failed = 0;
      for (const c of candidates) {
        const content = (c.editedText ?? c.text).slice(0, 1500);
        const tags = [`user:${userId}`, `subsystem:${subsystem}`, "scope:user"];
        try {
          const out = await memory.retain(TWIN_BANK_ID, [{ content, tags }]);
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
            err: err instanceof Error ? err.message : String(err),
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
    logger.error("[digital-twin] /clusters/:subsystem/approve failed", { err: err instanceof Error ? err.message : String(err) });
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
      updates["editedText"] = body.editedText.slice(0, 1500);
    }

    let hindsightMemoryId: string | null = candidate.hindsightMemoryId ?? null;
    if (body.status === "approved" && candidate.status === "pending") {
      const content = (typeof body.editedText === "string" ? body.editedText : candidate.text).slice(0, 1500);
      const tags = [`user:${userId}`, `subsystem:${candidate.subsystem}`, "scope:user"];
      try {
        const out = await memory.retain(TWIN_BANK_ID, [{ content, tags }]);
        hindsightMemoryId = out?.[0]?.id ?? null;
      } catch (err) {
        logger.warn("[digital-twin] retain failed on patch-approve", {
          userId,
          candidateId: id,
          err: err instanceof Error ? err.message : String(err),
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
    logger.error("[digital-twin] PATCH /candidates/:id failed", { err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ── 8. .md upload (manual seed memories) ───────────────────────────────────

// ── 8. Settings (per-user Twin config) ─────────────────────────────────────
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
    const body = (req.body ?? {}) as { responseSuffix?: string | null };

    if (!("responseSuffix" in body)) {
      res.status(400).json({ success: false, error: "responseSuffix is required" });
      return;
    }

    // Normalize: trim, accept empty string OR null as "clear suffix".
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

    await prisma.user.update({
      where: { id: userId },
      data: { digitalTwinResponseSuffix: normalized },
    });

    res.json({ success: true, data: { responseSuffix: normalized ?? "" } });
  } catch (err) {
    logger.error("[digital-twin] PATCH /settings failed", { err: err instanceof Error ? err.message : String(err) });
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
    logger.error("[digital-twin] /upload-md failed", { err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});
