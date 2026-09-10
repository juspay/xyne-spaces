/**
 * Memory review routes — approve/reject curator-emitted subsystem memory
 * candidates before they reach Hindsight.
 *
 * Routes:
 *   GET   /memory/reviews        — list pending candidates (admin only)
 *   PATCH /memory/review/:id     — approve or reject a candidate
 *
 * Flow:
 *   - Pending rows have hindsightMemoryId = NULL (curator hasn't called retain yet).
 *   - On approve: retain the candidate's content to Hindsight with subsystem:X tag;
 *     if this is an update, delete the replaced memory AFTER the new one lands
 *     (retain-then-delete preserves the "one memory per subsystem" invariant
 *     even if the delete fails).
 *   - On reject: mark status=rejected; Hindsight is never touched.
 */

import { Router, type Request, type Response } from "express";
import { errMsg } from "../lib/errors.js";
import type { Prisma } from "@prisma/client";
import { bankIdForAgent, buildRetainMission, getMemoryProvider } from "xyne-claw-shared";
import type { MemoryRecord, EntityGraphEdge } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { agentRepository } from "../repositories/index.js";
import { createLogger, createTraceId } from "../logger.js";
import { requireAuth, requireUserAuth, s2sKeyMatches } from "../middleware/require-auth.js";
import { isClawAdmin, requireClawAdmin, getOrgId, getRequesterId, getAgentEditAccess } from "../middleware/agent-acl.js";
import { curateApprovedTranscript, persistSubsystemReviews, readSessionTranscript, type SessionTranscript } from "../services/memoryCronService.js";
import { classifySessionSubsystemForBank, distillSessionFile, parseSessionFile } from "../services/sessionCurator.js";
import { enqueueAgentBackfill, getAgentBackfillQueue } from "../queue/agent-backfill-queue.js";
import { runRetentionSweep } from "../services/memoryRetentionService.js";
import {
  getPromptFiles,
  getFile as getAgentFile,
  listFiles as listAgentFiles,
  upsertFile as upsertAgentFile,
  MAX_FILE_CHARS,
} from "../services/agentMemoryFiles.js";
import { ensureTwinBank, twinObservationScopes, VERBATIM_IMPORT_STRATEGY } from "../services/userMemoryCuratorClient.js";

const logger = createLogger("memory-review", createTraceId());

// All memory backend operations go through the provider abstraction.
// Default is HindsightProvider, swappable via the MEMORY_PROVIDER env var.
const memory = getMemoryProvider();

const DIGITAL_TWIN_SLUG = "digital-twin";
const DIGITAL_TWIN_BANK = bankIdForAgent(DIGITAL_TWIN_SLUG);

/**
 * Twin detection MUST key on the bank id, not the raw slug. bankIdForAgent
 * sanitizes (lowercase, collapse non-alphanumerics, truncate 44), so slugs
 * like "digital_twin" / "Digital-Twin" / "digital--twin" all resolve to the
 * twin's bank `xyne-digital-twin`. A raw `=== "digital-twin"` check would let
 * such an agent reach the shared twin bank WITHOUT the per-user `user:<id>`
 * scoping — exposing every user's personal memories. Anything that lands in
 * the twin bank gets twin treatment.
 */
function isDigitalTwinAgent(agentSlug: string | undefined): boolean {
  return !!agentSlug && bankIdForAgent(agentSlug) === DIGITAL_TWIN_BANK;
}

async function assertMemoryUserAccess(
  req: Request,
  res: Response,
  targetUserId: string,
): Promise<boolean> {
  if (s2sKeyMatches(req.headers["x-s2s-key"])) return true;
  const requesterId = getRequesterId(req);
  if (requesterId && requesterId === targetUserId) return true;
  if (requesterId && (await isClawAdmin(requesterId))) return true;
  res.status(403).json({ success: false, error: "You can only access your own memory files." });
  return false;
}

export const memoryRouter = Router();

/**
 * GET /memory/agent-prompt-files?agentSlug=&userId=
 *
 * Internal (S2S): returns the file-based memory files flagged loadInPrompt for
 * (agentSlug, userId) — the always-loaded persona (soul.md, …) that xyne-claw
 * injects into the agent's system prompt at run start. Mounted under the memory
 * router which accepts x-s2s-key. Degrades to an empty list on any error so a
 * missing/slow file store never breaks a run.
 */
memoryRouter.get("/agent-prompt-files", requireAuth, async (req, res) => {
  try {
    const userId = typeof req.query["userId"] === "string" ? req.query["userId"].trim() : "";
    const agentSlug =
      typeof req.query["agentSlug"] === "string" && req.query["agentSlug"].trim()
        ? (req.query["agentSlug"] as string).trim()
        : DIGITAL_TWIN_SLUG;
    if (!userId) {
      res.json({ success: true, data: { files: [] } });
      return;
    }
    if (!(await assertMemoryUserAccess(req, res, userId))) return;
    const files = await getPromptFiles(agentSlug, userId);
    res.json({
      success: true,
      data: { files: files.map((f) => ({ name: f.name, content: f.content })) },
    });
  } catch (err) {
    logger.error("[memory] agent-prompt-files failed", { err: errMsg(err) });
    res.json({ success: true, data: { files: [] } });
  }
});

const AGENT_FILE_NAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;

/**
 * GET /memory/agent-file?agentSlug=&userId=&name=
 * Internal (S2S): deterministic file read for the mid-chat read-memory-file
 * tool. With `name` → that file's content; without → the list of file names.
 */
memoryRouter.get("/agent-file", requireAuth, async (req, res) => {
  try {
    const userId = typeof req.query["userId"] === "string" ? req.query["userId"].trim() : "";
    const agentSlug =
      typeof req.query["agentSlug"] === "string" && req.query["agentSlug"].trim()
        ? (req.query["agentSlug"] as string).trim()
        : DIGITAL_TWIN_SLUG;
    const name = typeof req.query["name"] === "string" ? req.query["name"].trim() : "";
    if (!userId) {
      res.json({ success: true, data: { file: null, files: [] } });
      return;
    }
    if (!(await assertMemoryUserAccess(req, res, userId))) return;
    if (name) {
      const f = await getAgentFile(agentSlug, userId, name);
      res.json({
        success: true,
        data: { file: f ? { name: f.name, content: f.content, loadInPrompt: f.loadInPrompt } : null },
      });
      return;
    }
    const files = await listAgentFiles(agentSlug, userId);
    res.json({
      success: true,
      data: { files: files.map((f) => ({ name: f.name, chars: f.content.length, loadInPrompt: f.loadInPrompt })) },
    });
  } catch (err) {
    logger.error("[memory] agent-file read failed", { err: errMsg(err) });
    res.json({ success: true, data: { file: null, files: [] } });
  }
});

/**
 * POST /memory/agent-file  { agentSlug, userId, name, content, mode }
 * Internal (S2S): mid-chat write-memory-file tool. mode "append" (default)
 * concatenates to the existing file; "replace" overwrites. Provenance "agent".
 */
memoryRouter.post("/agent-file", requireAuth, async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      agentSlug?: unknown;
      userId?: unknown;
      name?: unknown;
      content?: unknown;
      mode?: unknown;
    };
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const agentSlug =
      typeof body.agentSlug === "string" && body.agentSlug.trim() ? body.agentSlug.trim() : DIGITAL_TWIN_SLUG;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const content = typeof body.content === "string" ? body.content : "";
    const mode = body.mode === "replace" ? "replace" : "append";
    if (!userId || !AGENT_FILE_NAME_RE.test(name) || !content.trim()) {
      res.status(400).json({ success: false, error: "userId, valid name, and content are required" });
      return;
    }
    if (!(await assertMemoryUserAccess(req, res, userId))) return;
    let finalContent = content;
    if (mode === "append") {
      const current = await getAgentFile(agentSlug, userId, name);
      finalContent = current?.content ? `${current.content.trimEnd()}\n\n${content.trim()}` : content.trim();
    }
    const file = await upsertAgentFile({ agentSlug, userId, name, content: finalContent, updatedBy: "agent" });
    res.json({
      success: true,
      data: { file: { name: file.name, chars: file.content.length, maxChars: MAX_FILE_CHARS } },
    });
  } catch (err) {
    logger.error("[memory] agent-file write failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * In-process lock to dedupe concurrent approve requests for the same batch.
 * Approve does N×LLM calls (~30s/session); a full batch can take 20+ minutes,
 * which exceeds the ingress 504 timeout. The POST endpoint responds 202 and
 * runs the work via setImmediate — this Set prevents a double-click from
 * launching two background loops over the same sessions.
 *
 * Lost on pod restart, which is fine: a restart leaves the batch in status
 * "pending", so an admin can simply re-click Approve to resume.
 */
const inFlightApprovals = new Set<string>();

function startApprovalInBackground(batchId: string, sessionIds?: string[]): void {
  if (inFlightApprovals.has(batchId)) return;
  inFlightApprovals.add(batchId);
  setImmediate(async () => {
    try {
      await approveBatch(batchId, sessionIds);
    } catch (err) {
      logger.error("[memory] Background approve crashed", {
        batchId,
        err: errMsg(err),
      });
    } finally {
      inFlightApprovals.delete(batchId);
    }
  });
}

/**
 * Per-user gate for the `digital-twin` bank — used by EVERY route that
 * touches this bank. Returns true if the request is allowed to proceed,
 * false if a 403/401 has already been written.
 *
 * Why a helper: the digital-twin Hindsight bank is shared across all
 * opted-in users; per-user scoping lives in the `user:<id>` tag. Any
 * unguarded route on this bank is a cross-user data leak. Privacy
 * incident on 2026-05-25 (Aalok saw Anurag's memories) traced to
 * exactly this — 14 of 18 routes lacked the gate. Centralising into one
 * helper means a new route can't silently miss it.
 *
 * Three modes:
 *  - "read"     : require ?userTag=user:<requesterId> on query
 *  - "delete"   : verify the target hindsightMemoryId is tagged for the
 *                 requester (object-level ownership check)
 *  - "bank-op"  : enable/disable on the digital-twin bank is forbidden
 *                 for everyone — the bank is shared infra. Per-user opt-in
 *                 lives in users.digitalTwinEnabled.
 */
async function checkTwinAccess(
  req: Request,
  res: Response,
  agentSlug: string,
  mode: "read" | "delete" | "bank-op",
  opts: { userTag?: string; hindsightMemoryId?: string } = {},
): Promise<boolean> {
  if (!isDigitalTwinAgent(agentSlug)) return true;

  const requesterId = (req.headers["x-user-id"] as string | undefined)?.trim();
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Authentication required for digital-twin bank" });
    return false;
  }
  const expectedTag = `user:${requesterId}`;

  if (mode === "bank-op") {
    res.status(403).json({
      success: false,
      error: "Bank-level operations on digital-twin are not supported — per-user opt-in is at /digital-twin/enable",
    });
    return false;
  }

  if (mode === "read") {
    if (!opts.userTag || opts.userTag !== expectedTag) {
      res.status(403).json({
        success: false,
        error: "Digital Twin operations are per-user; userTag must match requester",
      });
      return false;
    }
    return true;
  }

  if (mode === "delete") {
    if (!opts.hindsightMemoryId) {
      res.status(400).json({ success: false, error: "hindsightMemoryId required" });
      return false;
    }
    // Object-level check: only delete memories tagged for the requester.
    const getMemoryFn = memory.getMemory?.bind(memory);
    if (!getMemoryFn) {
      // Provider doesn't expose getMemory — fail closed to be safe.
      res.status(403).json({ success: false, error: "Cannot verify ownership; delete refused" });
      return false;
    }
    const memo = await getMemoryFn(bankIdForAgent("digital-twin"), opts.hindsightMemoryId).catch(() => null);
    if (!memo) {
      res.status(404).json({ success: false, error: "Memory not found" });
      return false;
    }
    if (!(memo.tags ?? []).includes(expectedTag)) {
      res.status(403).json({
        success: false,
        error: "Cannot delete another user's Digital Twin memory",
      });
      return false;
    }
    return true;
  }

  return true;
}

/**
 * GET /memory/reviews
 * List pending memory reviews. Admins only.
 */
memoryRouter.get("/reviews", requireUserAuth, requireClawAdmin, async (req, res) => {
  try {
    const { agentSlug, status = "pending", limit = "20", offset = "0" } = req.query as Record<string, string>;

    const reviews = await prisma.pendingMemoryReview.findMany({
      where: {
        status,
        ...(agentSlug ? { agentSlug } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Number(limit),
      skip: Number(offset),
    });

    // Session-ingest rows carry the WHOLE transcript (up to 200K chars) as
    // content — the approve path reads it from the DB, but the list/UI only
    // needs a preview. Without this cap one page of ingest rows is multi-MB.
    const data = reviews.map((r) =>
      r.action === "ingest_session" && r.content.length > 2_000
        ? { ...r, content: `${r.content.slice(0, 2_000)}\n\n…[transcript preview — full ${r.content.length}-char session is retained on approval]` }
        : r,
    );

    res.json({ success: true, data });
  } catch (err) {
    logger.error("[memory] GET /reviews failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * PATCH /memory/review/:id
 * Body: { action: "approve" | "reject" }
 *
 * Only path for per-candidate decisions. The curator-driven pipeline does
 * not emit Spaces per-memory buttons; batch-level approval lives on a
 * different endpoint (POST /memory/batches/:id/approve).
 */
memoryRouter.patch("/review/:id", requireUserAuth, requireClawAdmin, async (req, res) => {
  const { action } = req.body as { action?: string };
  await handleReviewAction((req.params["id"] as string) ?? "", action ?? "", res);
});

/**
 * POST /memory/reviews/approve-all
 * Body: { agentSlug?: string }
 *
 * Approve EVERY pending review row (optionally scoped to one agent): retain
 * each row's content and mark it approved. Rows whose retain fails stay
 * pending (nothing is lost; re-run to retry). Capped per call so a huge
 * backlog can't hold the request open forever — the response says how many
 * remain.
 */
memoryRouter.post("/reviews/approve-all", requireUserAuth, requireClawAdmin, async (req, res) => {
  try {
    const { agentSlug } = (req.body ?? {}) as { agentSlug?: string };
    const BATCH = 200;
    const rows = await prisma.pendingMemoryReview.findMany({
      where: { status: "pending", ...(agentSlug ? { agentSlug } : {}) },
      orderBy: { createdAt: "asc" },
      take: BATCH,
    });

    let approved = 0;
    let failed = 0;
    for (const review of rows) {
      try {
        const hindsightMemoryId = await retainReviewRow(review);
        await prisma.pendingMemoryReview.update({
          where: { id: review.id },
          data: { status: "approved", ...(hindsightMemoryId ? { hindsightMemoryId } : {}), updatedAt: new Date() },
        });
        approved++;
      } catch (err) {
        failed++;
        logger.warn("[memory] approve-all: retain failed for row — left pending", {
          reviewId: review.id,
          agentSlug: review.agentSlug,
          err: errMsg(err),
        });
      }
    }

    const remaining = await prisma.pendingMemoryReview.count({
      where: { status: "pending", ...(agentSlug ? { agentSlug } : {}) },
    });

    logger.info("[memory] approve-all complete", { agentSlug: agentSlug ?? "(all)", approved, failed, remaining, by: getRequesterId(req) });
    res.json({ success: true, data: { approved, failed, remaining } });
  } catch (err) {
    logger.error("[memory] POST /reviews/approve-all failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * POST /memory/reviews/reject-all
 * Body: { agentSlug?: string }
 *
 * Reject EVERY pending review row (optionally scoped to one agent). Pure
 * status flip — nothing was retained for pending rows, so nothing touches
 * the bank. The one-click cleanup for stale blob-era candidate backlogs.
 */
memoryRouter.post("/reviews/reject-all", requireUserAuth, requireClawAdmin, async (req, res) => {
  try {
    const { agentSlug } = (req.body ?? {}) as { agentSlug?: string };
    const result = await prisma.pendingMemoryReview.updateMany({
      where: { status: "pending", ...(agentSlug ? { agentSlug } : {}) },
      data: { status: "rejected", updatedAt: new Date() },
    });
    logger.info("[memory] reject-all complete", { agentSlug: agentSlug ?? "(all)", rejected: result.count, by: getRequesterId(req) });
    res.json({ success: true, data: { rejected: result.count } });
  } catch (err) {
    logger.error("[memory] POST /reviews/reject-all failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * Retain one pending review row's content to the agent's (tuned) bank.
 * Shared by single approve, approve-all, and nothing else. Throws on retain
 * failure — callers decide whether that's a 502 or a skip-and-continue.
 *
 * 2026-07-17: retain-then-delete REMOVED here. The old "one memory per
 * subsystem, full replacement" invariant capped every subsystem at one
 * ≤1500-char blob and made updates destructive (last-writer-wins
 * forgetting). Facts now ACCUMULATE; Hindsight's extraction + consolidation
 * own dedupe/conflict resolution. review.replacesMemoryId is ignored.
 */
async function retainReviewRow(review: {
  id: string;
  agentSlug: string;
  subsystem: string | null;
  sessionId: string | null;
  content: string;
  curatorConfidence: number | null;
  action: string | null;
}): Promise<string | null> {
  const bankId = bankIdForAgent(review.agentSlug);
  // Tuned bank: retain_mission steers Hindsight's fact extraction toward
  // the agent's domain (verified 2026-07-17: unsteered defaults produce
  // thin generic facts). Best-effort agent lookup for the description.
  const agentRow = await prisma.agent.findFirst({
    where: { slug: review.agentSlug },
    select: { name: true, description: true },
  }).catch(() => null);
  await memory.ensureBank(bankId, {
    mission: `Shared memory for xyne-claw agent "${review.agentSlug}".`,
    retainMission: buildRetainMission({ name: agentRow?.name ?? review.agentSlug, description: agentRow?.description ?? null }),
  });
  const isIngest = review.action === "ingest_session";
  const retained = await memory.retain(bankId, [
    {
      content: review.content,
      tags: [
        `agent:${review.agentSlug}`,
        "shared",
        ...(review.subsystem ? [`subsystem:${review.subsystem}`] : []),
        ...(review.sessionId ? [`session:${review.sessionId}`] : []),
      ],
      metadata: {
        agentSlug: review.agentSlug,
        ...(review.subsystem ? { subsystem: review.subsystem } : {}),
        ...(review.sessionId ? { sessionId: review.sessionId } : {}),
        ...(review.curatorConfidence != null ? { curatorConfidence: String(review.curatorConfidence) } : {}),
        source: isIngest ? "session-ingest" : "curator-approved",
        action: review.action ?? "create",
      },
    },
  ]);
  return retained.find((r) => r.id)?.id ?? null;
}

async function handleReviewAction(
  reviewId: string,
  action: string,
  res: import("express").Response,
): Promise<void> {
  if (!reviewId || (action !== "approve" && action !== "reject")) {
    res.status(400).json({ success: false, error: "action must be 'approve' or 'reject'" });
    return;
  }

  try {
    const review = await prisma.pendingMemoryReview.findUnique({ where: { id: reviewId } });
    if (!review) {
      res.status(404).json({ success: false, error: "Review not found" });
      return;
    }
    if (review.status !== "pending") {
      res.json({ success: true, message: `Already ${review.status}` });
      return;
    }

    let newHindsightMemoryId: string | null = null;

    if (action === "approve") {
      try {
        newHindsightMemoryId = await retainReviewRow(review);
        logger.info("[memory] Memory approved and retained", {
          provider: memory.name,
          reviewId,
          agentSlug: review.agentSlug,
          subsystem: review.subsystem,
          action: review.action,
          isNewSubsystem: review.isNewSubsystem,
          hindsightMemoryId: newHindsightMemoryId,
        });
      } catch (err) {
        logger.error("[memory] Retain failed on approve — leaving status pending", {
          err: errMsg(err),
          reviewId,
        });
        res.status(502).json({ success: false, error: "Retain failed — try again." });
        return;
      }
    }

    await prisma.pendingMemoryReview.update({
      where: { id: reviewId },
      data: {
        status: action === "approve" ? "approved" : "rejected",
        ...(newHindsightMemoryId ? { hindsightMemoryId: newHindsightMemoryId } : {}),
        updatedAt: new Date(),
      },
    });

    logger.info("[memory] Review processed", { reviewId, action, agentSlug: review.agentSlug });

    res.json({ success: true, action, reviewId });
  } catch (err) {
    logger.error("[memory] Failed to process review action", {
      err: errMsg(err),
      reviewId,
    });
    res.status(500).json({ success: false, error: "Internal error" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Memory tab — admin-only endpoints used by AgentDetailPage Memory tab.
// All scoped to one agent (slug in path). Pagination, search, hot list, force
// delete, and a live Hindsight recall tester for sanity-checking memory
// quality without spinning up an agent session.
// ─────────────────────────────────────────────────────────────────────────────

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** POST /memory/banks/:agentSlug/retention-sweep — admin-only, dry-run by default. */
memoryRouter.post("/banks/:agentSlug/retention-sweep", requireClawAdmin, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    const body = (req.body ?? {}) as { dryRun?: unknown; maxInvalidations?: unknown };
    if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
      res.status(400).json({ success: false, error: "dryRun must be a boolean" });
      return;
    }
    if (body.maxInvalidations !== undefined
      && (!Number.isInteger(body.maxInvalidations) || (body.maxInvalidations as number) < 1)) {
      res.status(400).json({ success: false, error: "maxInvalidations must be a positive integer" });
      return;
    }
    const summary = await runRetentionSweep(agentSlug, {
      dryRun: body.dryRun !== false,
      ...(body.maxInvalidations !== undefined ? { maxInvalidations: body.maxInvalidations as number } : {}),
    });
    logger.info("[memory] Admin retention sweep complete", {
      agentSlug,
      requesterId: getRequesterId(req),
      dryRun: body.dryRun !== false,
      ...summary,
    });
    res.json({ success: true, data: summary });
  } catch (err) {
    const message = errMsg(err);
    logger.error("[memory] POST retention-sweep failed", { err: message });
    res.status(message.startsWith("Refusing") || message.includes("disabled") || message.includes("not opted in") ? 400 : 500)
      .json({ success: false, error: message });
  }
});

/**
 * GET /memory/banks/:agentSlug/memories
 * Query: ?scope=user|shared&search=...&limit=50&offset=0
 *
 * Lists Hindsight's extracted memories for this agent, joined with the
 * last-7d recall-hit counts from MemoryRecallHit. Scope is inferred from
 * the memory's tags (`shared` or `user:{uid}`).
 */
memoryRouter.get("/banks/:agentSlug/memories", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    const { scope, search, subsystem, userTag, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const take = Math.min(Number(limit) || 50, 200);
    const skip = Math.max(Number(offset) || 0, 0);

    // Privacy gate: the `digital-twin` bank is shared by every user who has
    // opted in. A list call MUST be restricted to the requester's own
    // user-tag — otherwise one user could enumerate everyone else's Twin
    // memories.  We require `?userTag=user:<id>` AND that it matches the
    // requesting userId. Other agent banks (assistant, doctor, etc.) are
    // shared/agent-scoped so they don't need this gate.
    const requesterId = (req.headers["x-user-id"] as string | undefined)?.trim();
    if (isDigitalTwinAgent(agentSlug)) {
      const expected = requesterId ? `user:${requesterId}` : "";
      if (!userTag || userTag !== expected) {
        res.status(403).json({
          success: false,
          error: "Digital Twin memories are per-user; userTag must match requester",
        });
        return;
      }
    }

    const bankId = bankIdForAgent(agentSlug);

    // For digital-twin we DO NOT trust Hindsight's tag-filter as a privacy
    // boundary — incident 2026-05-25 confirmed the provider over-matches
    // user-tag queries (returns ALL bank memories regardless of the tag
    // we pass). Authoritative scoping is done in JS below, against the
    // session-verified `user:<requesterId>` tag.
    //
    // We still pass the tag as a HINT (it may help perf if Hindsight ever
    // gains exact-match support), but we fetch wider than `take` so the
    // post-filter has room to find the user's actual records even if
    // Hindsight returned a mixed bag.
    if (isDigitalTwinAgent(agentSlug) && userTag) {
      // Wide because the twin bank is SHARED across users and Hindsight can't
      // tag-filter server-side — we over-fetch then filter to `userTag`. Sized
      // to surface a heavy user's full set so pagination can page through it.
      const WIDE_FETCH = Number(process.env["TWIN_MEMORIES_WIDE_FETCH"] ?? 2000);
      const widePage = await memory.listMemories(bankId, {
        limit: WIDE_FETCH,
        offset: 0,
        ...(search && search.trim().length > 0 ? { search: search.trim() } : {}),
        tags: [userTag],
      });

      // AUTHORITATIVE user-scope filter — JS, not provider.
      let scoped = widePage.memories.filter((m) => (m.tags ?? []).includes(userTag));
      // Optional subsystem narrowing inside the user's scope.
      if (subsystem && subsystem.trim().length > 0) {
        const subsystemTag = `subsystem:${subsystem.trim()}`;
        scoped = scoped.filter((m) => (m.tags ?? []).includes(subsystemTag));
      }

      const total = scoped.length;
      const items = scoped.slice(skip, skip + take);

      const ids = items.map((m) => m.id);
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const hits = ids.length === 0
        ? []
        : await prisma.memoryRecallHit.groupBy({
            by: ["hindsightMemoryId"],
            where: { agentSlug, hindsightMemoryId: { in: ids }, recalledAt: { gte: cutoff } },
            _count: { _all: true },
            _max: { recalledAt: true },
          });
      const hitMap = new Map(hits.map((h) => [h.hindsightMemoryId, { count: h._count._all, lastHit: h._max.recalledAt }]));

      // Trace link: the pipeline event that proposed each memory is carried on
      // the memory itself as a `pipeline:<eventId>` tag (added at retain time).
      // We read it straight from the tags — NOT via candidate.hindsightMemoryId,
      // which Hindsight's retain leaves null. Memories retained before this tag
      // existed simply have no pipeline: tag → the UI shows "No trace".
      const data = items.map((m) => {
        const tags = m.tags ?? [];
        const isShared = tags.includes("shared");
        const ownerTag = tags.find((t) => t.startsWith("user:"));
        const sessionTag = tags.find((t) => t.startsWith("session:"));
        const categoryTag = tags.find((t) => t.startsWith("cat:"));
        const resolvedScope: "user" | "shared" | null = isShared ? "shared" : ownerTag ? "user" : null;
        return {
          id: m.id,
          hindsightMemoryId: m.id,
          scope: resolvedScope,
          category: categoryTag ? categoryTag.slice(4) : (m.factType ?? null),
          content: m.content,
          userId: ownerTag ? ownerTag.slice(5) : null,
          sessionId: sessionTag ? sessionTag.slice(8) : null,
          factType: m.factType ?? null,
          tags,
          // Needed by the archive export: entity links are the majority of the
          // constellation's edges, and a verbatim restore can only rebuild them
          // if the export carried the entities.
          entities: m.entities ?? [],
          // Source-fact count. An observation starts at 1 and is incremented by
          // the same consolidation pass that writes a history row, so >1 is a
          // free "this has history" signal — the list response carries no
          // dedicated flag, and probing the history endpoint per memory would
          // cost one request each.
          proofCount: m.proofCount ?? null,
          createdAt: m.createdAt ?? null,
          recallHits7d: hitMap.get(m.id)?.count ?? 0,
          lastRecalledAt: hitMap.get(m.id)?.lastHit ?? null,
          pipelineEventId: tags.find((t) => t.startsWith("pipeline:"))?.slice("pipeline:".length) ?? null,
        };
      });

      res.json({
        success: true,
        data,
        total,
        limit: take,
        offset: skip,
        provider: memory.name,
      });
      return;
    }

    // ── Non-digital-twin banks: legacy path (provider-filtered) ────────
    // Shared agent banks can still hold user-scoped memories (tag `user:<id>`),
    // so a caller must not read another user's personal records by passing an
    // arbitrary `userTag` (or scope=user). Only an admin may query across
    // users; everyone else is pinned to their own user-tag.
    const isAdmin = requesterId ? await isClawAdmin(requesterId) : false;
    if (!isAdmin) {
      const ownTag = requesterId ? `user:${requesterId}` : "";
      if (userTag && userTag.startsWith("user:") && userTag !== ownTag) {
        res.status(403).json({ success: false, error: "userTag must match the requesting user" });
        return;
      }
    }
    const listFilter: { limit: number; offset: number; search?: string; tags?: string[] } = {
      limit: take,
      offset: skip,
    };
    if (search && search.trim().length > 0) listFilter.search = search.trim();
    // Tag filter is OR-matched by the provider, so we pick the most specific
    // single tag. Order of preference:
    //   1. userTag (e.g. `user:<id>`) — strongest scoping
    //   2. subsystem:<slug> — clusters within a bank
    //   3. shared (legacy agent-memory scope)
    if (userTag && userTag.trim().length > 0) {
      listFilter.tags = [userTag.trim()];
    } else if (subsystem && subsystem.trim().length > 0) {
      listFilter.tags = [`subsystem:${subsystem.trim()}`];
    } else if (scope === "shared") {
      listFilter.tags = ["shared"];
    }

    const page = await memory.listMemories(bankId, listFilter);

    let items = page.memories;
    if (scope === "user") {
      // Non-admins only ever see their own user-scoped records here (the
      // userTag guard above pins them); admins may see all user-tagged ones.
      const ownTag = requesterId ? `user:${requesterId}` : "";
      items = items.filter((m) => {
        const tags = m.tags ?? [];
        if (!tags.some((t) => t.startsWith("user:"))) return false;
        return isAdmin || tags.includes(ownTag);
      });
    }

    const ids = items.map((m) => m.id);
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const hits = ids.length === 0
      ? []
      : await prisma.memoryRecallHit.groupBy({
          by: ["hindsightMemoryId"],
          where: { agentSlug, hindsightMemoryId: { in: ids }, recalledAt: { gte: cutoff } },
          _count: { _all: true },
          _max: { recalledAt: true },
        });
    const hitMap = new Map(hits.map((h) => [h.hindsightMemoryId, { count: h._count._all, lastHit: h._max.recalledAt }]));

    const data = items.map((m) => {
      const tags = m.tags ?? [];
      const isShared = tags.includes("shared");
      const ownerTag = tags.find((t) => t.startsWith("user:"));
      const sessionTag = tags.find((t) => t.startsWith("session:"));
      const categoryTag = tags.find((t) => t.startsWith("cat:"));
      const resolvedScope: "user" | "shared" | null = isShared ? "shared" : ownerTag ? "user" : null;
      return {
        id: m.id,
        hindsightMemoryId: m.id,
        scope: resolvedScope,
        category: categoryTag ? categoryTag.slice(4) : (m.factType ?? null),
        content: m.content,
        userId: ownerTag ? ownerTag.slice(5) : null,
        sessionId: sessionTag ? sessionTag.slice(8) : null,
        factType: m.factType ?? null,
        tags,
        createdAt: m.createdAt ?? null,
        recallHits7d: hitMap.get(m.id)?.count ?? 0,
        lastRecalledAt: hitMap.get(m.id)?.lastHit ?? null,
      };
    });

    res.json({
      success: true,
      data,
      total: page.total ?? data.length,
      limit: take,
      offset: skip,
      provider: memory.name,
    });
  } catch (err) {
    logger.error("[memory] GET /banks/:agentSlug/memories failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * GET /memory/banks/:agentSlug/stats?range=7d|30d|90d
 *
 * Returns: total approved memory count (split by scope), pending count,
 * total recalls in range, and the top-N hottest memories (ranked by
 * recall hit count) for the Hot Memories panel.
 */
memoryRouter.get("/banks/:agentSlug/stats", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    const range = (req.query["range"] as string) || "7d";
    const userTag = (req.query["userTag"] as string | undefined)?.trim();
    const days = RANGE_DAYS[range] ?? 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const bankId = bankIdForAgent(agentSlug);

    // Per-user privacy gate for the digital-twin bank — see /memories route.
    const requesterId = (req.headers["x-user-id"] as string | undefined)?.trim();
    if (isDigitalTwinAgent(agentSlug)) {
      const expected = requesterId ? `user:${requesterId}` : "";
      if (!userTag || userTag !== expected) {
        res.status(403).json({ success: false, error: "Digital Twin stats are per-user; userTag must match requester" });
        return;
      }
    }

    // ── Digital-twin: per-user stats path ────────────────────────────
    //
    // Every counter and the hot list is computed from THIS user's
    // memories only. Hindsight's tag filter is not trusted (incident
    // 2026-05-25); JS-side filter on `user:<requesterId>` is the
    // authoritative privacy boundary.
    //
    // - approved        = count of memories whose tags include user:<id>
    // - pending         = count from userMemoryCandidate (Twin's HITL queue)
    // - recallsInRange  = count of MemoryRecallHit rows whose
    //                     hindsightMemoryId belongs to this user's memories
    // - hot             = top-N recalled memories LIMITED to this user's ids
    if (isDigitalTwinAgent(agentSlug) && userTag && requesterId) {
      const WIDE_FETCH = 500;
      const userMemoriesPage = await memory.listMemories(bankId, {
        limit: WIDE_FETCH,
        offset: 0,
        tags: [userTag],
      }).catch(() => ({ memories: [], total: 0 }));

      // AUTHORITATIVE filter — JS only.
      const userMemories = userMemoriesPage.memories.filter(
        (m) => (m.tags ?? []).includes(userTag),
      );
      const userMemoryIds = userMemories.map((m) => m.id);
      const userMemoryById = new Map(userMemories.map((m) => [m.id, m]));

      const [pendingCount, totalRecalls, topHits] = await Promise.all([
        prisma.userMemoryCandidate.count({
          where: { userId: requesterId, status: "pending" },
        }),
        userMemoryIds.length === 0
          ? Promise.resolve(0)
          : prisma.memoryRecallHit.count({
              where: {
                agentSlug,
                hindsightMemoryId: { in: userMemoryIds },
                recalledAt: { gte: cutoff },
              },
            }),
        userMemoryIds.length === 0
          ? Promise.resolve([])
          : prisma.memoryRecallHit.groupBy({
              by: ["hindsightMemoryId"],
              where: {
                agentSlug,
                hindsightMemoryId: { in: userMemoryIds },
                recalledAt: { gte: cutoff },
              },
              _count: { _all: true },
              _max: { recalledAt: true },
              orderBy: { _count: { hindsightMemoryId: "desc" } },
              take: 20,
            }),
      ]);

      const totalApproved = userMemories.length;
      const totalUserScope = userMemories.filter((m) =>
        (m.tags ?? []).some((t) => t.startsWith("user:")),
      ).length;
      const totalSharedScope = 0; // Twin memories are never shared-scope.

      const hot = topHits.map((h) => {
        const m = userMemoryById.get(h.hindsightMemoryId) ?? null;
        const tags = m?.tags ?? [];
        const isShared = tags.includes("shared");
        const ownerTag = tags.find((t) => t.startsWith("user:"));
        const categoryTag = tags.find((t) => t.startsWith("cat:"));
        return {
          hindsightMemoryId: h.hindsightMemoryId,
          hits: h._count._all,
          lastRecalledAt: h._max.recalledAt,
          content: m?.content ?? "(deleted from provider — recall history retained)",
          scope: isShared ? "shared" : ownerTag ? "user" : null,
          category: categoryTag ? categoryTag.slice(4) : (m?.factType ?? null),
          factType: m?.factType ?? null,
          status: m ? "approved" : "rejected",
          createdAt: m?.createdAt ?? null,
        };
      });

      res.json({
        success: true,
        data: {
          range,
          totals: {
            approved: totalApproved,
            approvedUserScope: totalUserScope,
            approvedSharedScope: totalSharedScope,
            pending: pendingCount,
            recallsInRange: totalRecalls,
          },
          hot,
          provider: memory.name,
        },
      });
      return;
    }

    // ── Non-digital-twin: legacy agent-memory path ───────────────────
    const orgId = getOrgId(req);
    if (!orgId) {
      logger.error(`[memory/stats] orgId is required; refusing global memory stats agentSlug=${agentSlug}`);
      res.status(400).json({ success: false, error: "orgId is required" });
      return;
    }
    const listFilter: { limit: number; offset: number; tags?: string[] } = { limit: 500, offset: 0 };
    if (userTag) listFilter.tags = [userTag];

    const [allPage, pendingBatchCount, totalRecalls, topHits] = await Promise.all([
      memory.listMemories(bankId, listFilter).catch(() => ({ memories: [], total: 0 })),
      prisma.pendingBatchReview.count({ where: { orgId, agentSlug, status: "pending" } }),
      prisma.memoryRecallHit.count({ where: { orgId, agentSlug, recalledAt: { gte: cutoff } } }),
      prisma.memoryRecallHit.groupBy({
        by: ["hindsightMemoryId"],
        where: { orgId, agentSlug, recalledAt: { gte: cutoff } },
        _count: { _all: true },
        _max: { recalledAt: true },
        orderBy: { _count: { hindsightMemoryId: "desc" } },
        take: 20,
      }),
    ]);

    const visibleMemories = allPage.memories;
    const totalApproved = allPage.total ?? allPage.memories.length;
    const totalSharedScope = visibleMemories.filter((m) => (m.tags ?? []).includes("shared")).length;
    const totalUserScope = visibleMemories.filter((m) =>
      (m.tags ?? []).some((t) => t.startsWith("user:")),
    ).length;

    const ids = topHits.map((h) => h.hindsightMemoryId);
    const hotMemoriesById = new Map<string, MemoryRecord | null>();
    const getMemoryFn = memory.getMemory?.bind(memory);
    if (ids.length > 0 && getMemoryFn) {
      const fetched = await Promise.all(
        ids.map((id) => getMemoryFn(bankId, id).catch(() => null)),
      );
      ids.forEach((id, i) => hotMemoriesById.set(id, fetched[i] ?? null));
    }

    const hot = topHits.map((h) => {
      const m = hotMemoriesById.get(h.hindsightMemoryId);
      const tags = m?.tags ?? [];
      const isShared = tags.includes("shared");
      const ownerTag = tags.find((t) => t.startsWith("user:"));
      const categoryTag = tags.find((t) => t.startsWith("cat:"));
      return {
        hindsightMemoryId: h.hindsightMemoryId,
        hits: h._count._all,
        lastRecalledAt: h._max.recalledAt,
        content: m?.content ?? "(deleted from provider — recall history retained)",
        scope: isShared ? "shared" : ownerTag ? "user" : null,
        category: categoryTag ? categoryTag.slice(4) : (m?.factType ?? null),
        factType: m?.factType ?? null,
        status: m ? "approved" : "rejected",
        createdAt: m?.createdAt ?? null,
      };
    });

    res.json({
      success: true,
      data: {
        range,
        totals: {
          approved: totalApproved,
          approvedUserScope: totalUserScope,
          approvedSharedScope: totalSharedScope,
          pending: pendingBatchCount,
          recallsInRange: totalRecalls,
        },
        hot,
        provider: memory.name,
      },
    });
  } catch (err) {
    logger.error("[memory] GET /banks/:agentSlug/stats failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * GET /memory/banks/:agentSlug/subsystem-graph
 *
 * Builds a SUBSYSTEM-level graph: nodes are the agent's curated subsystems
 * (one per distinct `subsystem:X` tag), edges connect subsystems that share
 * source sessions. Far more meaningful than the raw entity cooccurrence
 * graph for understanding what an agent "knows" — the structure mirrors
 * the curator's mental model, not Hindsight's token-frequency view.
 *
 * Edge meaning: "These two subsystems contain memories curated from the
 * SAME agent_runs sessions" — i.e., investigating one area touched the
 * other.
 */
memoryRouter.get("/banks/:agentSlug/subsystem-graph", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    const userTag = (req.query["userTag"] as string | undefined)?.trim();
    const bankId = bankIdForAgent(agentSlug);

    // Per-user privacy gate for the digital-twin bank — see /memories route.
    const requesterId = (req.headers["x-user-id"] as string | undefined)?.trim();
    if (isDigitalTwinAgent(agentSlug)) {
      const expected = requesterId ? `user:${requesterId}` : "";
      if (!userTag || userTag !== expected) {
        res.status(403).json({ success: false, error: "Digital Twin graph is per-user; userTag must match requester" });
        return;
      }
    }

    const listFilter: { limit: number; tags?: string[] } = { limit: 500 };
    if (userTag) listFilter.tags = [userTag];

    const pageRaw = await memory.listMemories(bankId, listFilter).catch(() => ({ memories: [] }));
    // Defense-in-depth: drop anything not tagged for the requester.
    const page = (isDigitalTwinAgent(agentSlug) && userTag)
      ? { memories: pageRaw.memories.filter((m) => (m.tags ?? []).includes(userTag)) }
      : pageRaw;

    // Group memories by subsystem tag. Each subsystem accumulates: count,
    // contributing session ids, and a sample content snippet for tooltips.
    interface AggregatedSubsystem {
      name: string;
      memoryCount: number;
      sessionIds: Set<string>;
      sampleContent: string;
      lastUpdated: string | null;
    }
    const bySubsystem = new Map<string, AggregatedSubsystem>();

    for (const m of page.memories) {
      const subsystemTag = (m.tags ?? []).find((t) => t.startsWith("subsystem:"));
      if (!subsystemTag) continue;
      const name = subsystemTag.slice("subsystem:".length);
      if (!name) continue;
      let entry = bySubsystem.get(name);
      if (!entry) {
        entry = {
          name,
          memoryCount: 0,
          sessionIds: new Set(),
          sampleContent: "",
          lastUpdated: null,
        };
        bySubsystem.set(name, entry);
      }
      entry.memoryCount++;
      if (m.content && entry.sampleContent.length < m.content.length) {
        entry.sampleContent = m.content.slice(0, 400);
      }
      if (m.createdAt && (!entry.lastUpdated || m.createdAt > entry.lastUpdated)) {
        entry.lastUpdated = m.createdAt;
      }
      for (const t of m.tags ?? []) {
        if (t.startsWith("session:")) entry.sessionIds.add(t.slice("session:".length));
      }
    }

    const subsystemList = [...bySubsystem.values()];

    // Build edges from session overlap. O(n²) but n is small (≤ ~12 subsystems
    // per agent in steady state). Edge only when at least one shared session.
    const edges: Array<{ source: string; target: string; sharedSessions: number }> = [];
    for (let i = 0; i < subsystemList.length; i++) {
      for (let j = i + 1; j < subsystemList.length; j++) {
        const a = subsystemList[i];
        const b = subsystemList[j];
        if (!a || !b) continue;
        let shared = 0;
        for (const s of a.sessionIds) if (b.sessionIds.has(s)) shared++;
        if (shared > 0) {
          edges.push({ source: a.name, target: b.name, sharedSessions: shared });
        }
      }
    }

    res.json({
      success: true,
      data: {
        subsystems: subsystemList.map((s) => ({
          name: s.name,
          memoryCount: s.memoryCount,
          sessionCount: s.sessionIds.size,
          sampleContent: s.sampleContent,
          lastUpdated: s.lastUpdated,
        })),
        edges,
      },
      provider: memory.name,
    });
  } catch (err) {
    logger.error("[memory] GET /banks/:agentSlug/subsystem-graph failed", {
      err: errMsg(err),
    });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * GET /memory/banks/:agentSlug/graph
 *
 * Returns the entity cooccurrence graph for the agent's bank — nodes are
 * canonical entities (with mention counts), edges are typed relations
 * between them. Used by the Memory tab's Graph sub-view.
 *
 * Returns { nodes: [], edges: [] } when the provider doesn't support
 * entity graphs OR the bank is empty.
 */
memoryRouter.get("/banks/:agentSlug/graph", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    const userTag = (req.query["userTag"] as string | undefined)?.trim();
    if (!(await checkTwinAccess(req, res, agentSlug, "read", { ...(userTag && { userTag }) }))) return;
    const bankId = bankIdForAgent(agentSlug);
    const getGraph = memory.getEntityGraph?.bind(memory);
    if (!getGraph || !memory.capabilities.entityGraph) {
      res.json({ success: true, data: { nodes: [], edges: [] }, provider: memory.name });
      return;
    }

    // ── Digital-twin: per-user entity graph ──────────────────────────
    //
    // Hindsight's graph is BANK-aggregated — nodes (entities) and edges
    // (cooccurrences) are computed across every user's memories without
    // per-user metadata, so we can't filter the response after the fact.
    //
    // BUT: entity NAMES are bank-canonical (Hindsight's NLP knows
    // "Aravind" and "Aravind Sethuraj" are the same node). The COUNTS
    // and EDGES, however, are derived counts that we can recompute from
    // just this user's memories.
    //
    // Strategy: keep Hindsight's canonical entity LABELS, but recompute
    //   - mentionCount: how many of THIS user's memories mention entity
    //   - edges/weight: cooccurrence within THIS user's memories
    //
    // Entities the user never mentions are dropped entirely.
    if (isDigitalTwinAgent(agentSlug) && userTag) {
      const requesterId = userTag.startsWith("user:") ? userTag.slice("user:".length) : "";

      const [bankGraph, userMemoriesPage] = await Promise.all([
        getGraph(bankId).catch(() => ({ nodes: [], edges: [] })),
        memory.listMemories(bankId, {
          limit: 500,
          offset: 0,
          tags: [userTag],
        }).catch(() => ({ memories: [], total: 0 })),
      ]);

      // AUTHORITATIVE: JS filter on the requester's own user-tag.
      const userMemories = userMemoriesPage.memories.filter(
        (m) => (m.tags ?? []).includes(userTag),
      );

      if (userMemories.length === 0 || bankGraph.nodes.length === 0) {
        res.json({ success: true, data: { nodes: [], edges: [] }, provider: memory.name });
        return;
      }

      // For each canonical entity, find which user memories mention it.
      // Substring match on `content` is cheap enough at this scale
      // (≤200 entities × ≤500 memories) and handles Hindsight's
      // canonicalisation for free (whatever label it picked is what
      // appears in the memory text).
      const perEntityMemoryIds = new Map<string, Set<string>>();
      for (const node of bankGraph.nodes) {
        if (!node.label || node.label.length < 2) continue;
        const needle = node.label.toLowerCase();
        const hits = new Set<string>();
        for (const m of userMemories) {
          if ((m.content ?? "").toLowerCase().includes(needle)) {
            hits.add(m.id);
          }
        }
        if (hits.size > 0) perEntityMemoryIds.set(node.id, hits);
      }

      // Per-user nodes: only entities mentioned in ≥1 user memory,
      // with recomputed mentionCount from user's memories.
      const userNodes = bankGraph.nodes
        .filter((n) => perEntityMemoryIds.has(n.id))
        .map((n) => ({
          ...n,
          mentionCount: perEntityMemoryIds.get(n.id)?.size ?? 0,
        }));

      // Per-user edges: cooccurrence COUNTED from user's memories.
      // For each pair (a, b) of entities present, count how many of the
      // user's memories mention BOTH. weight = that count.
      const userEdges: EntityGraphEdge[] = [];
      const presentIds = [...perEntityMemoryIds.keys()];
      for (let i = 0; i < presentIds.length; i++) {
        for (let j = i + 1; j < presentIds.length; j++) {
          const aId = presentIds[i];
          const bId = presentIds[j];
          if (!aId || !bId) continue;
          const aMems = perEntityMemoryIds.get(aId);
          const bMems = perEntityMemoryIds.get(bId);
          if (!aMems || !bMems) continue;
          let shared = 0;
          for (const id of aMems) if (bMems.has(id)) shared++;
          if (shared > 0) {
            userEdges.push({
              id: `e-${aId}-${bId}-${requesterId}`,
              source: aId,
              target: bId,
              linkType: "cooccurrence",
              weight: shared,
            });
          }
        }
      }

      res.json({
        success: true,
        data: { nodes: userNodes, edges: userEdges },
        provider: memory.name,
      });
      return;
    }

    // ── Non-twin agents: bank-wide entity graph (unchanged) ─────────
    const graph = await getGraph(bankId);
    res.json({ success: true, data: graph, provider: memory.name });
  } catch (err) {
    logger.error("[memory] GET /banks/:agentSlug/graph failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * POST /memory/banks/:agentSlug/recall
 * Body: { query: string, scope?: "user"|"shared", userId?: string, budget?: "low"|"mid"|"high" }
 *
 * Proxies a Hindsight recall for the admin "Recall Tester" panel. Lets an
 * admin paste a query, pick a scope, and see what Hindsight would return.
 * Does NOT log to MemoryRecallHit (manual test queries shouldn't inflate
 * the hot-memory rankings).
 */
memoryRouter.post("/banks/:agentSlug/recall", requireUserAuth, async (req, res) => {
  const agentSlug = req.params["agentSlug"] as string;
  try {
    const { query, scope, userId, budget = "low" } = req.body as {
      query?: string;
      scope?: "user" | "shared";
      userId?: string;
      budget?: "low" | "mid" | "high";
    };
    logger.info("[memory] recall request", {
      agentSlug,
      bankId: bankIdForAgent(agentSlug),
      queryLen: query?.length ?? 0,
      budget,
      ...(scope ? { scope } : {}),
    });
    if (!query || query.trim().length === 0) {
      res.status(400).json({ success: false, error: "query is required" });
      return;
    }

    // Privacy gate: digital-twin bank's recall MUST be scoped to the
    // requesting user — otherwise an admin could probe another user's
    // memories via the recall tester. Force user-scope with the requester's
    // ID, regardless of what the request body asks for.
    const requesterId = (req.headers["x-user-id"] as string | undefined)?.trim();
    const tags: string[] = [];
    if (isDigitalTwinAgent(agentSlug)) {
      if (!requesterId) {
        res.status(401).json({ success: false, error: "x-user-id header required for Digital Twin recall" });
        return;
      }
      tags.push(`user:${requesterId}`);
    } else if (scope === "shared") {
      tags.push("shared");
    } else if (scope === "user") {
      if (!userId) {
        res.status(400).json({ success: false, error: "userId is required for user-scope recall" });
        return;
      }
      // Pin to the requester's own user-scope unless they're an admin —
      // otherwise any logged-in user could probe another user's personal
      // memories stored in a shared bank by passing userId=<victim>.
      const isAdmin = requesterId ? await isClawAdmin(requesterId) : false;
      if (!isAdmin && userId !== requesterId) {
        res.status(403).json({ success: false, error: "userId must match the requesting user" });
        return;
      }
      tags.push(`user:${userId}`);
    }

    const rawResults = await memory.recall(bankIdForAgent(agentSlug), query, {
      budget,
      ...(tags.length > 0 ? { tags } : {}),
    });
    // AUTHORITATIVE filter for digital-twin: Hindsight's tag-filter on
    // the recall path is not trusted (same incident as /memories — see
    // route comment). Drop anything the requester's user-tag isn't on.
    const results = (isDigitalTwinAgent(agentSlug) && requesterId)
      ? rawResults.filter((m) => (m.tags ?? []).includes(`user:${requesterId}`))
      : rawResults;
    logger.info("[memory] recall result", {
      agentSlug,
      queryPreview: query.slice(0, 60),
      rawCount: rawResults.length,
      resultCount: results.length,
    });
    res.json({
      success: true,
      data: {
        provider: memory.name,
        memories: results.map((m) => ({ id: m.id, text: m.text, fact_type: m.factType, tags: m.tags, score: m.score })),
      },
    });
  } catch (err) {
    logger.error("[memory] recall failed", {
      agentSlug,
      err: errMsg(err),
    });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * DELETE /memory/banks/:agentSlug/memories/:hindsightMemoryId
 *
 * Force-delete a memory: removes it from Hindsight, then marks any matching
 * PendingMemoryReview rows as rejected so they don't show in the All list.
 * MemoryRecallHit rows are retained for historical hit-count fidelity.
 */
/**
 * GET /memory/banks/:agentSlug/memories/:hindsightMemoryId/history
 *
 * Prior versions of one memory, newest first.
 *
 * Ownership is checked with the SAME object-level gate as delete: the twin bank
 * is shared across every user in the org, so proxying an id straight through
 * would let anyone read another user's memory history. `checkTwinAccess` in
 * "delete" mode is exactly the check we want — it verifies the memory carries
 * the requester's `user:<id>` tag — even though this is a read.
 *
 * Returns [] rather than 404 for a memory with no history: Hindsight only keeps
 * history for derived observations, so "no history" is the normal case and not
 * an error the UI should have to special-case.
 */
memoryRouter.get(
  "/banks/:agentSlug/memories/:hindsightMemoryId/history",
  requireUserAuth,
  async (req, res) => {
    try {
      const agentSlug = req.params["agentSlug"] as string;
      const hindsightMemoryId = req.params["hindsightMemoryId"] as string;

      if (!(await checkTwinAccess(req, res, agentSlug, "delete", { hindsightMemoryId }))) return;

      const getHistory = memory.getMemoryHistory?.bind(memory);
      if (!getHistory) {
        // Provider has no version history at all — an empty list is the honest
        // answer, and keeps the UI identical to "this memory has none".
        res.json({ success: true, data: [] });
        return;
      }

      const history = await getHistory(bankIdForAgent(agentSlug), hindsightMemoryId);
      res.json({ success: true, data: history });
    } catch (err) {
      logger.error("[memory] GET /banks/:agentSlug/memories/:id/history failed", {
        err: errMsg(err),
      });
      res.status(500).json({ success: false, error: "Internal error" });
    }
  },
);

memoryRouter.delete("/banks/:agentSlug/memories/:hindsightMemoryId", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    const hindsightMemoryId = req.params["hindsightMemoryId"] as string;

    // Object-level ownership check: verify the memory carries the
    // requester's user:<id> tag before allowing delete. Otherwise any
    // logged-in user could delete arbitrary Twin memories by ID.
    if (!(await checkTwinAccess(req, res, agentSlug, "delete", { hindsightMemoryId }))) return;

    await memory.deleteMemory(bankIdForAgent(agentSlug), hindsightMemoryId);

    await prisma.pendingMemoryReview.updateMany({
      where: { agentSlug, hindsightMemoryId, status: { in: ["pending", "approved"] } },
      data: { status: "rejected", updatedAt: new Date() },
    });

    logger.info("[memory] Memory force-deleted", {
      provider: memory.name,
      agentSlug,
      hindsightMemoryId,
      by: getRequesterId(req),
    });
    res.json({ success: true });
  } catch (err) {
    const msg = errMsg(err);
    if (msg.includes("HINDSIGHT_DERIVED_OBSERVATION")) {
      logger.info("[memory] Direct delete refused for derived observation", {
        agentSlug: req.params["agentSlug"],
        hindsightMemoryId: req.params["hindsightMemoryId"],
        by: getRequesterId(req),
      });
      res.status(409).json({
        success: false,
        code: "HINDSIGHT_DERIVED_OBSERVATION",
        error:
          "This is a derived Hindsight observation and cannot be deleted directly. Delete its supporting world or experience memories; Hindsight will then recompute or remove the observation automatically.",
      });
      return;
    }
    logger.error("[memory] DELETE /banks/:agentSlug/memories/:hindsightMemoryId failed", { err: msg });
    // Hindsight too old to support per-memory invalidate (405). Not a bug in this
    // service — return an actionable 503 so the UI shows a real reason instead of
    // a generic "Internal error", and ops knows to upgrade Hindsight.
    if (msg.includes("HINDSIGHT_CURATION_UNSUPPORTED")) {
      res.status(503).json({
        success: false,
        error: "Memory deletion is unavailable on this environment — the Hindsight service needs an upgrade (reversible curation).",
        code: "HINDSIGHT_CURATION_UNSUPPORTED",
      });
      return;
    }
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * POST /memory/banks/:agentSlug/consolidate
 *
 * Queue a consolidation run — the pass that derives and updates observations
 * (and, with them, the version history the dashboard shows) from raw facts.
 *
 * Hindsight already schedules this after every retain, but only when the bank
 * has enable_observations + enable_auto_consolidation. Facts retained while
 * either was off stay unconsolidated indefinitely, and facts stranded by a
 * terminal failure are excluded from selection permanently. This endpoint is
 * how you drain those, and how you exercise consolidation deterministically
 * instead of waiting for organic retain traffic.
 *
 * SCOPING IS THE POINT: the twin bank is SHARED across every user in the org.
 * An unscoped run would consolidate everyone's facts and bill everyone's LLM
 * work to whoever pressed the button, so the twin path always forces
 * `[["user:<requester>"]]` and ignores any caller-supplied scope. Scoped runs
 * also bypass Hindsight's bank-level dedupe, so one user's request is never
 * swallowed by another's pending sweep.
 *
 * Async: 202 means QUEUED, not done. `deduplicated: true` means an equivalent
 * job was already pending and this call joined it.
 */
memoryRouter.post("/banks/:agentSlug/consolidate", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }

    const isTwin = isDigitalTwinAgent(agentSlug);
    if (!isTwin) {
      // Non-twin banks are shared per-agent, so restrict to owner/admin.
      const agent = await agentRepository.findBySlug(agentSlug, getOrgId(req));
      if (!agent) {
        res.status(404).json({ success: false, error: "Agent not found" });
        return;
      }
      const admin = await isClawAdmin(requesterId);
      if (!admin && agent.ownerUserId !== requesterId) {
        res.status(403).json({ success: false, error: "Only the agent owner or an admin can trigger consolidation." });
        return;
      }
    }

    const consolidate = memory.consolidate?.bind(memory);
    if (!consolidate) {
      res.status(501).json({
        success: false,
        error: `Provider "${memory.name}" does not support consolidation.`,
      });
      return;
    }

    // Twin: always the requester's own facts, never the whole shared bank.
    const result = await consolidate(bankIdForAgent(agentSlug), {
      ...(isTwin ? { observationScopes: [[`user:${requesterId}`]] } : {}),
    });

    logger.info("[memory] consolidation queued", {
      agentSlug,
      scoped: isTwin,
      operationId: result.operationId,
      deduplicated: result.deduplicated,
      by: requesterId,
    });
    res.status(202).json({ success: true, data: result });
  } catch (err) {
    logger.error("[memory] POST /banks/:agentSlug/consolidate failed", {
      err: errMsg(err),
    });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/** Curator subsystems a memory may be filed under. An archive carrying anything
 *  else is filed under `context` rather than rejected — an unknown subsystem is
 *  a labelling problem, not a reason to lose the fact. */
const IMPORT_SUBSYSTEMS = new Set([
  "style", "triage", "expertise", "projects", "relationships",
  "preferences", "decisions", "context", "docs",
]);

/**
 * Import pacing. Retain posts with `async: true` — Hindsight queues the LLM
 * fact-extraction and returns an operation id straight away — so awaiting each
 * call gives NO back-pressure: an unpaced loop submits the whole archive in
 * about a second and Hindsight then fans `retain_extract_facts` out across
 * every item at once. Its LLM key is capped (`max_parallel_requests`), so that
 * burst produces a wall of 429s and LiteLLM puts the deployments in cooldown
 * ("No deployments available"). Those failures happen INSIDE Hindsight, after
 * we already returned 200 — we never see them and cannot retry them, so
 * spacing submission out is the only lever this service has.
 *
 * Defaults are deliberately conservative and env-tunable, because the right
 * numbers depend on the key's parallel budget and how fast extraction drains.
 * Raise MEMORY_IMPORT_CHUNK / lower the delay once the key allows more.
 */
const IMPORT_CHUNK = Math.max(1, Number(process.env["MEMORY_IMPORT_CHUNK"] ?? 5));
const IMPORT_CHUNK_DELAY_MS = Math.max(0, Number(process.env["MEMORY_IMPORT_CHUNK_DELAY_MS"] ?? 3_000));
/** Per REQUEST, not per archive — the dashboard sends larger archives as
 *  successive batches so no single request runs long enough to be timed out by
 *  a proxy. At the defaults this is ~10 chunks ≈ 30s worst case. */
const IMPORT_MAX_RECORDS = Math.max(1, Number(process.env["MEMORY_IMPORT_MAX_RECORDS"] ?? 50));
const IMPORT_MAX_CONTENT_CHARS = 4_000;
/** Per record. Hindsight's own extraction rarely exceeds a handful. */
const IMPORT_MAX_ENTITIES = 32;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST /memory/banks/:agentSlug/memories/import
 *
 * Restore memories from an archive produced by the dashboard's export. Retains
 * each record into the bank as a fresh memory.
 *
 * SECURITY — the archive is user-supplied data, so every tag is DISCARDED and
 * re-derived from the authenticated requester. Tags decide a memory's scope
 * (see the `user:` / `scope:` handling in the list route), so honouring
 * `tags` from the file would let a crafted archive plant memories in another
 * user's twin, or promote them to `shared`. Only `content`, `subsystem` and
 * `timestamp` are read from the file, and `subsystem` is vocabulary-checked.
 *
 * NOT idempotent: Hindsight's retain re-runs fact extraction, so re-importing
 * the same archive creates new memories. Duplicate detection happens in the
 * dashboard, which already holds the full memory set and can diff before
 * sending. The response counts records SUBMITTED, not memories created —
 * extraction is async and one record may yield several facts or merge into one.
 */
memoryRouter.post("/banks/:agentSlug/memories/import", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }

    // Twin bank is per-user: writes are always scoped to the caller. Any other
    // bank is shared, so restrict restores to the owner/admin.
    const isTwin = isDigitalTwinAgent(agentSlug);
    if (!isTwin) {
      const agent = await agentRepository.findBySlug(agentSlug, getOrgId(req));
      if (!agent) {
        res.status(404).json({ success: false, error: "Agent not found" });
        return;
      }
      const admin = await isClawAdmin(requesterId);
      if (!admin && agent.ownerUserId !== requesterId) {
        res.status(403).json({ success: false, error: "Only the agent owner or an admin can import memories." });
        return;
      }
    }

    const body = (req.body ?? {}) as { records?: unknown; mode?: unknown };
    // "verbatim" (default): the records ARE extracted facts — a Xyne archive —
    // so Hindsight stores them as-is with no LLM. "extract": the records are
    // raw prose, so run them through normal fact extraction.
    const verbatim = body.mode !== "extract";
    if (!Array.isArray(body.records)) {
      res.status(400).json({ success: false, error: "records must be an array" });
      return;
    }
    if (body.records.length === 0) {
      res.status(400).json({ success: false, error: "records is empty" });
      return;
    }
    if (body.records.length > IMPORT_MAX_RECORDS) {
      res.status(413).json({
        success: false,
        error: `Too many records in one request (${body.records.length}); send at most ${IMPORT_MAX_RECORDS} per batch.`,
        code: "IMPORT_BATCH_TOO_LARGE",
        maxPerBatch: IMPORT_MAX_RECORDS,
      });
      return;
    }

    const items = [];
    for (const raw of body.records) {
      const rec = (raw ?? {}) as {
        content?: unknown;
        subsystem?: unknown;
        timestamp?: unknown;
        entities?: unknown;
      };
      const content = typeof rec.content === "string" ? rec.content.trim() : "";
      if (!content) continue;

      const sub = typeof rec.subsystem === "string" ? rec.subsystem.trim().toLowerCase() : "";
      const subsystem = IMPORT_SUBSYSTEMS.has(sub) ? sub : "context";

      // Keep the original event time so restored facts rank by when they
      // happened, not when they were restored. Rejected if unparseable or in
      // the future — a bad clock would outrank every real memory forever.
      let timestamp: string | undefined;
      if (typeof rec.timestamp === "string") {
        const ms = Date.parse(rec.timestamp);
        if (Number.isFinite(ms) && ms <= Date.now()) timestamp = new Date(ms).toISOString();
      }

      // Entities are what rebuild the constellation's entity edges. Verbatim
      // retains run no LLM, so anything not supplied here is simply absent.
      const entities = Array.isArray(rec.entities)
        ? rec.entities
            .map((e) => (typeof e === "string" ? e.trim() : ""))
            .filter((e) => e.length > 0 && e.length <= 200)
            .slice(0, IMPORT_MAX_ENTITIES)
            .map((text) => ({ text }))
        : [];

      items.push({
        content: content.slice(0, IMPORT_MAX_CONTENT_CHARS),
        tags: [`user:${requesterId}`, `subsystem:${subsystem}`, "scope:user", "source:import"],
        ...(timestamp ? { timestamp } : {}),
        observationScopes: twinObservationScopes(requesterId),
        ...(verbatim ? { strategy: VERBATIM_IMPORT_STRATEGY } : {}),
        ...(entities.length ? { entities } : {}),
      });
    }

    if (items.length === 0) {
      res.status(400).json({ success: false, error: "No record carried usable content." });
      return;
    }

    if (isTwin) await ensureTwinBank();
    const bankId = bankIdForAgent(agentSlug);

    // Chunk-level isolation: one bad chunk must not lose the rest of the
    // archive. Failures are counted and reported, never silently dropped.
    let submitted = 0;
    let failed = 0;
    // Verbatim has no LLM step, so it only needs a sane HTTP payload size.
    const chunkSize = verbatim ? Math.max(IMPORT_CHUNK, 25) : IMPORT_CHUNK;
    for (let i = 0; i < items.length; i += chunkSize) {
      // Space submissions out so Hindsight's extraction queue stays inside its
      // LLM key's parallel budget (see IMPORT_CHUNK_DELAY_MS above). Sleeping
      // BEFORE each chunk but the first keeps a single-chunk import instant.
      // Verbatim retains make no LLM call at all, so there is nothing to pace.
      if (!verbatim && i > 0 && IMPORT_CHUNK_DELAY_MS > 0) await sleep(IMPORT_CHUNK_DELAY_MS);
      const chunk = items.slice(i, i + chunkSize);
      try {
        await memory.retain(bankId, chunk);
        submitted += chunk.length;
      } catch (err) {
        failed += chunk.length;
        logger.warn("[memory] import chunk failed", {
          agentSlug,
          offset: i,
          size: chunk.length,
          err: errMsg(err),
        });
      }
    }

    logger.info("[memory] memories imported", {
      agentSlug, mode: verbatim ? "verbatim" : "extract",
      submitted, failed, skipped: body.records.length - items.length, by: requesterId,
    });
    res.json({
      success: true,
      data: { submitted, failed, skipped: body.records.length - items.length, verbatim },
    });
  } catch (err) {
    logger.error("[memory] POST /banks/:agentSlug/memories/import failed", {
      err: errMsg(err),
    });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * POST /memory/banks/:agentSlug/upload-md
 *
 * Seed an agent's memory bank from a markdown document — the agent-memory
 * counterpart to Digital Twin's /digital-twin/upload-md. Owner/admin only,
 * because the bank is shared across everyone who uses the agent.
 *
 * The .md is wrapped as a synthetic session transcript and run through the
 * SAME curator the nightly cron uses (curateApprovedTranscript), so the
 * extracted facts land as PENDING `PendingMemoryReview` rows for this agent —
 * NOT retained to the live bank until an admin approves them in the review
 * queue. Nothing about the agent's live memory changes on upload.
 */
memoryRouter.post("/banks/:agentSlug/upload-md", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }

    // Owner/admin gate.
    const agent = await agentRepository.findBySlug(agentSlug, getOrgId(req));
    if (!agent) {
      logger.warn(`[memory/upload-md] agent org-scoped miss slug=${agentSlug} orgId=${getOrgId(req) ?? "none"} userId=${userId}`);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const admin = await isClawAdmin(userId);
    if (!admin && agent.ownerUserId !== userId) {
      res.status(403).json({ success: false, error: "Only the agent owner or an admin can upload memory documents." });
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

    // Wrap the doc as a synthetic transcript; the curator extracts cluster-
    // tagged candidates from the `result` body, same as a real session.
    const now = new Date();
    const reviewDate = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const transcript: SessionTranscript = {
      sessionId: `upload-${now.getTime()}-${filename}`.slice(0, 200),
      userId,
      agentSlug,
      orgId: agent.orgId,
      conversationId: null,
      channelId: null,
      task: `Knowledge upload "${filename}" — extract durable, reusable facts and guidelines from this document for the agent's memory.`,
      result: content.slice(0, 50_000),
      toolsUsed: [],
      toolInvocations: [],
      tokensIn: 0,
      tokensOut: 0,
      approvalStrategy: "upload",
      startedAt: now,
      completedAt: now,
    };

    const reviewIds = await curateApprovedTranscript(transcript, reviewDate);

    logger.info("[memory] /upload-md curated agent document", {
      agentSlug, filename, candidatesCreated: reviewIds.length, by: userId,
    });
    res.json({ success: true, data: { filename, candidatesCreated: reviewIds.length } });
  } catch (err) {
    logger.error("[memory] POST /banks/:agentSlug/upload-md failed", {
      err: errMsg(err),
    });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch approval — one approval per (agent, night). Approval gate sits BEFORE
// retain: only approved sessions reach the memory provider, so rejected
// batches cost zero LLM extraction tokens.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /memory/batches
 * Query: ?agentSlug=...&status=pending|approved|rejected|partial&limit=20
 *
 * List batch reviews. Default sort: most recent first.
 */
memoryRouter.get("/batches", requireUserAuth, async (req, res) => {
  try {
    const { agentSlug, status, limit = "20", offset = "0" } = req.query as Record<string, string>;

    // ── Digital-twin: special-case to per-user candidate clusters ───
    //
    // PendingBatchReview is the agent-memory nightly-review concept;
    // Twin doesn't use it. Twin's per-user pending work lives in the
    // userMemoryCandidate table, grouped by subsystem.  We return a
    // shape compatible with the Batches tab UI (id / status / counts)
    // so the same client renderer works for both flavours.
    if (isDigitalTwinAgent(agentSlug)) {
      const requesterId = (req.headers["x-user-id"] as string | undefined)?.trim();
      if (!requesterId) {
        res.status(401).json({ success: false, error: "Authentication required for digital-twin batches" });
        return;
      }
      const grouped = await prisma.userMemoryCandidate.groupBy({
        by: ["subsystem", "status"],
        where: { userId: requesterId },
        _count: { _all: true },
        _max: { createdAt: true },
      });
      const bySubsystem = new Map<string, { pending: number; approved: number; rejected: number; latest: Date | null }>();
      for (const g of grouped) {
        const entry = bySubsystem.get(g.subsystem) ?? { pending: 0, approved: 0, rejected: 0, latest: null };
        if (g.status === "pending") entry.pending += g._count._all;
        else if (g.status === "approved") entry.approved += g._count._all;
        else if (g.status === "rejected") entry.rejected += g._count._all;
        if (g._max.createdAt && (!entry.latest || g._max.createdAt > entry.latest)) {
          entry.latest = g._max.createdAt;
        }
        bySubsystem.set(g.subsystem, entry);
      }
      const data = [...bySubsystem.entries()]
        .map(([subsystem, c]) => ({
          id: `twin:${requesterId}:${subsystem}`,
          agentSlug,
          subsystem,
          status: c.pending > 0 ? "pending" : c.approved > 0 ? "approved" : "rejected",
          pendingCount: c.pending,
          approvedCount: c.approved,
          rejectedCount: c.rejected,
          createdAt: c.latest,
          processing: false,
        }))
        .filter((row) => !status || row.status === status)
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      res.json({ success: true, data, total: data.length });
      return;
    }

    // ── Non-twin agents: legacy pendingBatchReview path ──────────────
    const orgId = getOrgId(req);
    if (!orgId) {
      logger.error(`[memory/batches] orgId is required; refusing global batch list agentSlug=${agentSlug ?? "none"} status=${status ?? "none"}`);
      res.status(400).json({ success: false, error: "orgId is required" });
      return;
    }
    const where: Record<string, unknown> = { orgId };
    if (agentSlug) where["agentSlug"] = agentSlug;
    if (status) where["status"] = status;

    const [batches, total] = await Promise.all([
      prisma.pendingBatchReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: Math.min(Number(limit) || 20, 100),
        skip: Math.max(Number(offset) || 0, 0),
      }),
      prisma.pendingBatchReview.count({ where }),
    ]);

    const enriched = batches.map((b) => ({ ...b, processing: inFlightApprovals.has(b.id) }));
    res.json({ success: true, data: enriched, total });
  } catch (err) {
    logger.error("[memory] GET /batches failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// The unauthenticated GET /batches/:id/spaces-action route is deleted. It was
// the callback for the Spaces digest approve/reject buttons, but that digest
// is no longer sent (see memoryCronService.ts — "the digests were noise"), so
// the route had no legitimate caller left while still letting anyone with a
// batch ID approve/reject memory batches without auth — and, being a
// state-mutating GET, link-preview bots prefetching the URL could fire it.
// Batch actions now go exclusively through POST /batches/:id/approve|reject
// below (requireUserAuth + requireClawAdmin).

/**
 * GET /memory/batches/:id
 * Returns the batch + per-session previews (task, toolsUsed, tokens). UI only.
 */
memoryRouter.get("/batches/:id", requireUserAuth, async (req, res) => {
  try {
    const batchId = req.params["id"] as string;
    const batch = await prisma.pendingBatchReview.findUnique({ where: { id: batchId } });
    if (!batch) {
      res.status(404).json({ success: false, error: "Batch not found" });
      return;
    }

    const previews: Array<{
      sessionId: string;
      task: string;
      toolsUsed: string[];
      tokensIn: number;
      tokensOut: number;
      missing?: boolean;
    }> = [];

    for (const sid of batch.sessionIds) {
      const t = await readSessionTranscript(sid);
      if (!t) {
        previews.push({ sessionId: sid, task: "(transcript missing)", toolsUsed: [], tokensIn: 0, tokensOut: 0, missing: true });
        continue;
      }
      previews.push({
        sessionId: sid,
        task: t.task.slice(0, 300),
        toolsUsed: t.toolsUsed,
        tokensIn: t.tokensIn,
        tokensOut: t.tokensOut,
      });
    }

    res.json({
      success: true,
      data: { batch: { ...batch, processing: inFlightApprovals.has(batch.id) }, sessions: previews },
    });
  } catch (err) {
    logger.error("[memory] GET /batches/:id failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * POST /memory/batches/:id/approve
 * Body: { sessionIds?: string[] }  // omit to approve everything in the batch
 *
 * For each approved session: read transcript → call provider.retain → record
 * the provider's returned memory IDs in retainedMemoryIds. Updates batch
 * status to "approved" (all approved) or "partial" (subset approved).
 */
memoryRouter.post("/batches/:id/approve", requireUserAuth, requireClawAdmin, async (req, res) => {
  try {
    const batchId = req.params["id"] as string;
    const body = (req.body ?? {}) as { sessionIds?: string[] };

    const batch = await prisma.pendingBatchReview.findUnique({ where: { id: batchId } });
    if (!batch) {
      res.status(404).json({ success: false, error: "Batch not found" });
      return;
    }
    if (batch.status !== "pending") {
      // Idempotent: surface the current terminal state instead of relaunching.
      res.json({
        success: true,
        data: {
          batchId,
          status: batch.status,
          approvedSessionCount: batch.approvedSessionIds.length,
          retainedMemoryCount: 0,
          failedSessions: [],
        },
      });
      return;
    }

    startApprovalInBackground(batchId, body.sessionIds);
    res.status(202).json({
      success: true,
      data: {
        batchId,
        status: "processing",
        sessionCount: body.sessionIds?.length ?? batch.sessionIds.length,
      },
    });
  } catch (err) {
    logger.error("[memory] POST /batches/:id/approve failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * POST /memory/recall-hits
 * Body: { hits: RecallHitLine[] }  — same shape claw used to append to JSONL.
 *
 * Live ingest endpoint for claw to record memory recalls. Replaces the
 * file-on-disk + nightly cron path that didn't work across pods (claw and
 * claw-auth had separate filesystems). Bulk-inserts with skipDuplicates so
 * a network retry can't double-count.
 *
 * Authenticated via the same requireAuth middleware as the rest of this
 * router — claw passes x-s2s-key (CONFIG.xyneClawS2sKey).
 */
interface RecallHitInput {
  agentSlug: string;
  hindsightMemoryId: string;
  userId: string;
  sessionId: string;
  scope: string;
  rank?: number | null;
  recalledAt: string;
}

/**
 * GET /memory/banks/:slug/admin-access?userId=<id>
 *
 * S2S authorization probe for xyne-claw's inspect-memory / mutate-memory agent
 * tools. claw resolves this ONCE per session to decide whether the human who
 * triggered the run may browse/mutate the agent's shared memory bank. Returns
 * the SAME decision as requireAgentOwnerContributorOrAdmin: agent owner OR an
 * EDITOR/CONTRIBUTOR share OR CLAW_ADMIN.
 *
 * The authorization subject is the run's triggering user (the `userId` query
 * param), NOT the request's requester — the S2S caller is claw, not the human.
 * Authenticated via requireAuth on the router mount (claw passes x-s2s-key).
 * Never 404s: an unknown/other-org agent resolves to allowed=false so claw
 * treats absence as deny (fail closed).
 */
memoryRouter.get("/banks/:slug/admin-access", async (req, res) => {
  try {
    const slug = req.params["slug"] as string | undefined;
    const userId = typeof req.query["userId"] === "string" ? req.query["userId"].trim() : "";
    if (!slug || !userId) {
      res.status(400).json({ success: false, error: "slug and userId are required" });
      return;
    }
    // S2S callback from claw carries no org context; derive the org from the
    // triggering user (User rows are org-scoped) so the agent lookup resolves
    // the right org's agent — same pattern as /recall-hits.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
    const orgId = getOrgId(req) ?? user?.orgId ?? null;
    const [access, admin] = await Promise.all([
      getAgentEditAccess(userId, slug, orgId),
      isClawAdmin(userId),
    ]);
    if (!access) {
      res.json({
        success: true,
        data: { allowed: admin, isOwner: false, isContributor: false, isClawAdmin: admin, reason: "agent_not_found" },
      });
      return;
    }
    const allowed = admin || access.canEdit;
    res.json({
      success: true,
      data: { allowed, isOwner: access.isOwner, isContributor: access.isContributor, isClawAdmin: admin },
    });
  } catch (err) {
    logger.error("[memory] GET /banks/:slug/admin-access failed", { err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

memoryRouter.post("/recall-hits", requireAuth, async (req, res) => {
  try {
    const body = (req.body ?? {}) as { hits?: RecallHitInput[] };
    const hits = Array.isArray(body.hits) ? body.hits : [];
    if (hits.length === 0) {
      res.json({ success: true, data: { inserted: 0 } });
      return;
    }

    // Org resolution (fixed 2026-07-17): this is an S2S callback from claw,
    // which carries NO org context on the request — the getOrgId(req) guard
    // added in the phase-2 org migration 400'd every batch, silently killing
    // recall-hit tracking from 2026-07-05 onward. Derive orgId PER HIT from
    // the run's user (User rows are org-scoped), which is also correct for
    // same-slug agents in different orgs.
    const userIds = [...new Set(hits.map((h) => h?.userId).filter((x): x is string => typeof x === "string" && !!x))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, orgId: true },
    });
    const orgByUser = new Map(users.map((u) => [u.id, u.orgId]));

    const rows = hits
      .filter((h) => h && h.agentSlug && h.hindsightMemoryId && h.userId && h.sessionId && h.scope && h.recalledAt && orgByUser.has(h.userId))
      .map((h) => ({
        agentSlug: h.agentSlug,
        orgId: orgByUser.get(h.userId) as string,
        hindsightMemoryId: h.hindsightMemoryId,
        userId: h.userId,
        sessionId: h.sessionId,
        scope: h.scope,
        rank: typeof h.rank === "number" ? h.rank : null,
        recalledAt: new Date(h.recalledAt),
      }))
      .filter((r) => !Number.isNaN(r.recalledAt.getTime()));

    const droppedUnknownUser = hits.length - rows.length;
    if (droppedUnknownUser > 0) {
      logger.warn(`[memory/recall-hits] dropped ${droppedUnknownUser}/${hits.length} hit(s) (unknown user or malformed)`);
    }

    if (rows.length === 0) {
      res.status(400).json({ success: false, error: "No valid hits in payload" });
      return;
    }

    const result = await prisma.memoryRecallHit.createMany({ data: rows, skipDuplicates: true });
    res.json({ success: true, data: { inserted: result.count, received: hits.length } });
  } catch (err) {
    logger.error("[memory] POST /recall-hits failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * POST /memory/batches/:id/reject
 * Mark the batch rejected. No transcripts are retained.
 */
memoryRouter.post("/batches/:id/reject", requireUserAuth, requireClawAdmin, async (req, res) => {
  try {
    const batchId = req.params["id"] as string;
    const ok = await rejectBatch(batchId);
    if (!ok) {
      res.status(404).json({ success: false, error: "Batch not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error("[memory] POST /batches/:id/reject failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ── Internal helpers ───────────────────────────────────────────────────────

interface ApproveResult {
  batchId: string;
  approvedSessionCount: number;
  retainedMemoryCount: number;
  failedSessions: string[];
}

async function approveBatch(batchId: string, sessionIds?: string[]): Promise<ApproveResult | null> {
  const batch = await prisma.pendingBatchReview.findUnique({ where: { id: batchId } });
  if (!batch) return null;
  if (batch.status !== "pending") {
    return {
      batchId,
      approvedSessionCount: batch.approvedSessionIds.length,
      retainedMemoryCount: 0,
      failedSessions: [],
    };
  }

  const targetSessionIds = sessionIds && sessionIds.length > 0
    ? sessionIds.filter((s) => batch.sessionIds.includes(s))
    : batch.sessionIds;

  const retainedByid: Record<string, string[]> = {};
  const failedSessions: string[] = [];
  let totalRetained = 0;

  for (const sid of targetSessionIds) {
    const transcript = await readSessionTranscript(sid);
    if (!transcript) {
      logger.warn("[memory] Approved session has no transcript on disk — skipping retain", { batchId, sessionId: sid });
      failedSessions.push(sid);
      continue;
    }
    try {
      const reviewIds = await curateApprovedTranscript(transcript, batch.reviewDate);
      retainedByid[sid] = reviewIds;
      totalRetained += reviewIds.length;
    } catch (err) {
      logger.error("[memory] Retain failed for approved session", {
        batchId,
        sessionId: sid,
        err: errMsg(err),
      });
      failedSessions.push(sid);
    }
  }

  const fullyApproved = targetSessionIds.length === batch.sessionIds.length && failedSessions.length === 0;
  const status = failedSessions.length === targetSessionIds.length
    ? "pending"
    : fullyApproved
      ? "approved"
      : "partial";

  await prisma.pendingBatchReview.update({
    where: { id: batchId },
    data: {
      status,
      approvedSessionIds: targetSessionIds.filter((s) => !failedSessions.includes(s)),
      retainedMemoryIds: retainedByid,
      updatedAt: new Date(),
    },
  });

  logger.info("[memory] Batch approved", {
    batchId,
    agentSlug: batch.agentSlug,
    approved: targetSessionIds.length,
    failed: failedSessions.length,
    retainedMemoryCount: totalRetained,
    status,
  });

  return {
    batchId,
    approvedSessionCount: targetSessionIds.length - failedSessions.length,
    retainedMemoryCount: totalRetained,
    failedSessions,
  };
}

async function rejectBatch(batchId: string): Promise<boolean> {
  const batch = await prisma.pendingBatchReview.findUnique({ where: { id: batchId } });
  if (!batch) return false;
  if (batch.status !== "pending") return true;

  await prisma.pendingBatchReview.update({
    where: { id: batchId },
    data: { status: "rejected", updatedAt: new Date() },
  });
  logger.info("[memory] Batch rejected", { batchId, agentSlug: batch.agentSlug });
  return true;
}

/**
 * POST /memory/banks/:agentSlug/backfill
 * Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }    (preferred)
 *   OR  { days: number }                              (legacy: today-N..today)
 *
 * Range is inclusive on both ends. Max span is 30 days.
 */
memoryRouter.post("/banks/:agentSlug/backfill", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    // For digital-twin, backfill is per-user and triggered via
    // /digital-twin/enable or /digital-twin/backfill — never on the
    // shared bank surface. Block to avoid cross-user backfill triggers.
    if (isDigitalTwinAgent(agentSlug)) {
      res.status(403).json({
        success: false,
        error: "Use /digital-twin/enable or /digital-twin/backfill for per-user Twin backfills",
      });
      return;
    }
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    const agent = await agentRepository.findBySlug(agentSlug, getOrgId(req));
    if (!agent) {
      logger.warn(`[memory/backfill] agent org-scoped miss slug=${agentSlug} orgId=${getOrgId(req) ?? "none"} userId=${requesterId}`);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    if (!(await isClawAdmin(requesterId)) && agent.ownerUserId !== requesterId) {
      res.status(403).json({ success: false, error: "Only the agent owner or an admin can backfill this agent's memory." });
      return;
    }
    const body = (req.body ?? {}) as { from?: string; to?: string; days?: number };

    let from: string;
    let to: string;
    const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

    if (body.from && body.to) {
      if (!ISO_RE.test(body.from) || !ISO_RE.test(body.to)) {
        res.status(400).json({ success: false, error: "'from' and 'to' must be YYYY-MM-DD" });
        return;
      }
      from = body.from;
      to = body.to;
    } else {
      const days = Math.floor(Number(body.days ?? 7));
      if (!Number.isFinite(days) || days < 1 || days > 30) {
        res.status(400).json({ success: false, error: "'days' must be an integer between 1 and 30" });
        return;
      }
      const today = new Date();
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - days);
      from = start.toISOString().slice(0, 10);
      to = today.toISOString().slice(0, 10);
    }

    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      res.status(400).json({ success: false, error: "invalid date" });
      return;
    }
    if (fromMs > toMs) {
      res.status(400).json({ success: false, error: "'from' must be ≤ 'to'" });
      return;
    }
    const spanDays = Math.floor((toMs - fromMs) / 86_400_000) + 1;
    if (spanDays > 30) {
      res.status(400).json({ success: false, error: "Range too wide (max 30 days)" });
      return;
    }

    // Enqueue a background job instead of running the walk+curate inline.
    // `backfillBatches` auto-curates each session (an LLM call apiece), so a
    // multi-day range blows past the ~60s nginx gateway timeout → 504. The
    // worker (agent-backfill-worker) runs it async; the UI polls the Pending
    // Review counts. Idempotent per (agent, range) at the queue level.
    const requestedBy = getRequesterId(req);
    const jobId = await enqueueAgentBackfill({
      agentSlug,
      from,
      to,
      ...(requestedBy ? { requestedBy } : {}),
    });
    logger.info("[memory] Backfill enqueued", { agentSlug, from, to, jobId, by: requestedBy });
    res.status(202).json({ success: true, data: { jobId, status: "queued", from, to } });
  } catch (err) {
    logger.error("[memory] POST /banks/:agentSlug/backfill failed", {
      err: errMsg(err),
    });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * GET /memory/banks/:agentSlug/backfill/:jobId
 *
 * Poll a queued backfill's state so the UI can show real progress instead of
 * pretending a 202 means done. Returns the BullMQ state plus the worker's
 * summary (returnvalue) once completed, or the failure reason.
 */
memoryRouter.get("/banks/:agentSlug/backfill/:jobId", requireUserAuth, async (req, res) => {
  try {
    const jobId = req.params["jobId"] as string;
    const job = await getAgentBackfillQueue().getJob(jobId);
    if (!job) {
      res.status(404).json({ success: false, error: "Backfill job not found (it may have completed and been cleaned up)" });
      return;
    }
    const state = await job.getState().catch(() => "unknown");
    res.json({
      success: true,
      data: {
        jobId,
        state,
        ...(state === "completed" ? { summary: job.returnvalue ?? null } : {}),
        ...(state === "failed" ? { failedReason: job.failedReason ?? null } : {}),
      },
    });
  } catch (err) {
    logger.error("[memory] GET backfill status failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Memory enrolment toggle
//
// Memory is OFF by default for every agent (the prefetch + transcript-dump
// gates check for an explicit `memoryEnabled === true`). These endpoints
// flip that bit in the agent's config blob.
// ─────────────────────────────────────────────────────────────────────────────

interface MemoryStatus {
  memoryEnabled: boolean;
  memorySharedAllowed: boolean;
  memoryApprovalStrategy: "HUMAN_ONLY" | "EVALS_ONLY" | "EVALS_THEN_HUMAN";
}

function readMemoryStatus(config: Record<string, unknown> | null | undefined): MemoryStatus {
  const c = (config ?? {}) as Record<string, unknown>;
  const strategy = String(c["memoryApprovalStrategy"] ?? "HUMAN_ONLY");
  return {
    memoryEnabled: c["memoryEnabled"] === true || c["memoryEnabled"] === "true",
    memorySharedAllowed: c["memorySharedAllowed"] === true || c["memorySharedAllowed"] === "true",
    memoryApprovalStrategy:
      strategy === "EVALS_ONLY" || strategy === "EVALS_THEN_HUMAN" ? strategy : "HUMAN_ONLY",
  };
}

/** GET /memory/banks/:agentSlug/status — current memory flags for the UI toggle. */
memoryRouter.get("/banks/:agentSlug/status", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    // For digital-twin, the bank-level status (memoryEnabled flag) is a
    // shared property; per-user opt-in is the relevant signal and lives
    // under /digital-twin/status. Refuse direct reads of the bank flag
    // for this slug to keep one source of truth.
    if (isDigitalTwinAgent(agentSlug)) {
      res.status(403).json({
        success: false,
        error: "digital-twin bank status — use /digital-twin/status for per-user state",
      });
      return;
    }
    const agent = await agentRepository.findBySlug(agentSlug, getOrgId(req));
    if (!agent) {
      logger.warn(`[memory/status] agent org-scoped miss slug=${agentSlug} orgId=${getOrgId(req) ?? "none"}`);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    res.json({ success: true, data: readMemoryStatus(agent.config as Record<string, unknown> | null) });
  } catch (err) {
    logger.error("[memory] GET status failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * POST /memory/banks/:agentSlug/enable
 * Body (optional): { sharedAllowed?: boolean, approvalStrategy?: string }
 *
 * Enrols the agent in the memory pipeline. From the next session onwards:
 * prefetch runs at start, transcript dumps at end, nightly cron picks it up.
 * Idempotent.
 */
memoryRouter.post("/banks/:agentSlug/enable", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    if (!(await checkTwinAccess(req, res, agentSlug, "bank-op"))) return;
    const body = (req.body ?? {}) as { sharedAllowed?: boolean; approvalStrategy?: string };

    const agent = await agentRepository.findBySlug(agentSlug, getOrgId(req));
    if (!agent) {
      logger.warn(`[memory/enable] agent org-scoped miss slug=${agentSlug} orgId=${getOrgId(req) ?? "none"}`);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    if (!(await isClawAdmin(requesterId)) && agent.ownerUserId !== requesterId) {
      res.status(403).json({ success: false, error: "Only the agent owner or an admin can manage this agent's memory." });
      return;
    }

    const config = { ...((agent.config as Record<string, unknown>) ?? {}) };
    config["memoryEnabled"] = true;
    if (typeof body.sharedAllowed === "boolean") config["memorySharedAllowed"] = body.sharedAllowed;
    if (body.approvalStrategy && ["HUMAN_ONLY", "EVALS_ONLY", "EVALS_THEN_HUMAN"].includes(body.approvalStrategy)) {
      config["memoryApprovalStrategy"] = body.approvalStrategy;
    } else if (config["memoryApprovalStrategy"] === undefined) {
      config["memoryApprovalStrategy"] = "HUMAN_ONLY";
    }

    await agentRepository.update(agentSlug, agent.orgId, { config: config as Prisma.InputJsonValue });

    logger.info("[memory] Agent enrolled in memory", {
      agentSlug,
      by: getRequesterId(req),
      ...readMemoryStatus(config),
    });

    res.json({ success: true, data: readMemoryStatus(config) });
  } catch (err) {
    logger.error("[memory] POST enable failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * POST /memory/banks/:agentSlug/disable
 * Flips memoryEnabled=false. Existing memories in the provider are untouched
 * (admin can purge separately). From the next session onwards, no prefetch or
 * transcript-dump fires for this agent.
 */
memoryRouter.post("/banks/:agentSlug/disable", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    if (!(await checkTwinAccess(req, res, agentSlug, "bank-op"))) return;
    const agent = await agentRepository.findBySlug(agentSlug, getOrgId(req));
    if (!agent) {
      logger.warn(`[memory/disable] agent org-scoped miss slug=${agentSlug} orgId=${getOrgId(req) ?? "none"}`);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    if (!(await isClawAdmin(requesterId)) && agent.ownerUserId !== requesterId) {
      res.status(403).json({ success: false, error: "Only the agent owner or an admin can manage this agent's memory." });
      return;
    }

    const config = { ...((agent.config as Record<string, unknown>) ?? {}) };
    config["memoryEnabled"] = false;

    await agentRepository.update(agentSlug, agent.orgId, { config: config as Prisma.InputJsonValue });

    logger.info("[memory] Agent unenrolled from memory", {
      agentSlug,
      by: getRequesterId(req),
    });

    res.json({ success: true, data: readMemoryStatus(config) });
  } catch (err) {
    logger.error("[memory] POST disable failed", { err: errMsg(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * POST /memory/banks/:agentSlug/clear-all
 *
 * Permanently removes every memory in an agent's bank while preserving the
 * bank and its configuration. Owner/admin only because the bank is shared.
 */
memoryRouter.post("/banks/:agentSlug/clear-all", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }

    const agent = await agentRepository.findBySlug(agentSlug, getOrgId(req));
    if (!agent) {
      logger.warn(`[memory/clear-all] agent org-scoped miss slug=${agentSlug} orgId=${getOrgId(req) ?? "none"} userId=${userId}`);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const admin = await isClawAdmin(userId);
    if (!admin && agent.ownerUserId !== userId) {
      res.status(403).json({ success: false, error: "Only the agent owner or an admin can clear all memories." });
      return;
    }

    if (!memory.clearAll) {
      res.status(501).json({ success: false, error: "The configured memory provider does not support clearing all memories." });
      return;
    }

    const deleted = await memory.clearAll(bankIdForAgent(agentSlug));
    const reviews = await prisma.pendingMemoryReview.updateMany({
      where: { agentSlug, status: { in: ["pending", "approved"] } },
      data: { status: "rejected", updatedAt: new Date() },
    });

    logger.info("[memory] All memories cleared", {
      agentSlug,
      deleted,
      by: userId,
    });
    res.json({ success: true, data: { deleted, reviewsRejected: reviews.count } });
  } catch (err) {
    logger.error("[memory] POST /banks/:agentSlug/clear-all failed", {
      err: errMsg(err),
    });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * DELETE /memory/banks/:agentSlug/subsystems/:subsystem
 *
 * Permanently removes every memory carrying `subsystem:<name>` in the agent's
 * bank. Owner/admin only, same policy as clear-all — a subsystem is a shared
 * slice of the bank, not any one user's data. Twin bank refused: its
 * subsystems (style/expertise/...) span EVERY user's personal facts.
 */
memoryRouter.delete("/banks/:agentSlug/subsystems/:subsystem", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    const subsystem = (req.params["subsystem"] as string).trim().toLowerCase();
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(subsystem)) {
      res.status(400).json({ success: false, error: "Invalid subsystem name" });
      return;
    }
    if (isDigitalTwinAgent(agentSlug)) {
      res.status(400).json({ success: false, error: "Subsystem deletion is not available for the Digital Twin." });
      return;
    }

    const agent = await agentRepository.findBySlug(agentSlug, getOrgId(req));
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const admin = await isClawAdmin(userId);
    if (!admin && agent.ownerUserId !== userId) {
      res.status(403).json({ success: false, error: "Only the agent owner or an admin can delete a subsystem." });
      return;
    }

    if (!memory.deleteByTag) {
      res.status(501).json({ success: false, error: "The configured memory provider does not support tag deletion." });
      return;
    }

    const deleted = await memory.deleteByTag(bankIdForAgent(agentSlug), `subsystem:${subsystem}`);
    const reviews = await prisma.pendingMemoryReview.updateMany({
      where: { agentSlug, subsystem, status: { in: ["pending", "approved"] } },
      data: { status: "rejected", updatedAt: new Date() },
    });

    logger.info("[memory] Subsystem deleted", { agentSlug, subsystem, deleted, by: userId });
    res.json({ success: true, data: { deleted, reviewsRejected: reviews.count } });
  } catch (err) {
    logger.error("[memory] DELETE /banks/:agentSlug/subsystems/:subsystem failed", {
      err: errMsg(err),
    });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * POST /memory/banks/:agentSlug/upload-session
 *
 * Upload a raw session export (Claude Code JSONL, claude.ai JSON, OpenCode bundle,
 * or Codex rollout JSONL) and distill it into the agent's shared memory.
 * Owner/admin only — the bank is shared across everyone who uses the agent.
 *
 * The raw export is sent to claw's /internal/curator/distill-session, which
 * parses + normalizes it and runs a chunked map-reduce distill so a large
 * session isn't truncated. The resulting candidates are persisted as PENDING
 * `PendingMemoryReview` rows (scope "shared") — NOT retained to the live bank
 * until an admin approves them. Nothing about the agent's live memory changes
 * on upload.
 *
 * Async: the parse + N-chunk distill is slow (many LLM calls), so the handler
 * responds 202 immediately and does the work in the background (same pattern as
 * batch approve). Uploaded candidates carry a `<source>-<ts>-<file>` sessionId so
 * admins can spot upload-sourced proposals in the review queue.
 */
memoryRouter.post("/banks/:agentSlug/upload-session", requireUserAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }

    // Owner/admin gate — identical to /upload-md.
    const agent = await agentRepository.findBySlug(agentSlug, getOrgId(req));
    if (!agent) {
      logger.warn(`[memory/upload-session] agent org-scoped miss slug=${agentSlug} orgId=${getOrgId(req) ?? "none"} userId=${userId}`);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const admin = await isClawAdmin(userId);
    if (!admin && agent.ownerUserId !== userId) {
      res.status(403).json({ success: false, error: "Only the agent owner or an admin can upload sessions." });
      return;
    }
    // The twin bank holds per-user private memories; a "shared" upload into it
    // is never correct (twin knowledge flows through the user-memory pipeline).
    if (bankIdForAgent(agentSlug) === bankIdForAgent("digital-twin")) {
      res.status(400).json({ success: false, error: "Sessions cannot be uploaded to the digital twin — twin memory is per-user and managed from the Digital Twin page." });
      return;
    }

    const body = (req.body ?? {}) as { filename?: string; content?: string; source?: string };
    const filename = (body.filename ?? "").trim();
    const content = (body.content ?? "").trim();
    const rawSource = (body.source ?? "claude").trim().toLowerCase();
    const source = ["claude", "opencode", "codex"].includes(rawSource) ? rawSource : "claude";
    if (!filename || !content) {
      res.status(400).json({ success: false, error: "filename and content are required" });
      return;
    }
    // express.json() is configured for 50 MB; cap sessions well under that.
    if (content.length > 20_000_000) {
      res.status(413).json({ success: false, error: "Session exceeds 20 MB limit" });
      return;
    }

    const now = new Date();
    const reviewDate = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const sessionId = `${source}-${now.getTime()}-${filename}`.slice(0, 200);

    // Respond immediately — the parse + map-reduce distill is slow and must not
    // block the request. Candidates appear in the review queue when done.
    res.status(202).json({ success: true, data: { sessionId, status: "processing" } });

    setImmediate(async () => {
      try {
        // Session-ingest path (2026-07-17, default ON): parse + clean on claw
        // (no LLM), then retain the transcript DIRECTLY — the uploader is the
        // owner/admin, so the upload itself is the approval, and the memory
        // provider's tuned extraction (verbose + retain_mission) produces the
        // facts. The legacy map-reduce distill (MEMORY_SESSION_INGEST=0)
        // queues per-subsystem review rows instead.
        if (process.env["MEMORY_SESSION_INGEST"] !== "0") {
          const parsed = await parseSessionFile({ sessionId, agentSlug, userId, filename, source, rawSession: content });
          if (!parsed) {
            logger.warn("[memory] /upload-session parse produced no transcript", { agentSlug, filename, by: userId });
            return;
          }
          const bankId = bankIdForAgent(agentSlug);
          await memory.ensureBank(bankId, {
            mission: `Shared memory for xyne-claw agent "${agentSlug}".`,
            retainMission: buildRetainMission({ name: agent.name, description: agent.description }),
          });
          const subsystem = await classifySessionSubsystemForBank(memory, bankId, {
            sessionId,
            agentSlug,
            agentName: agent.name,
            task: parsed.meta.task ?? `Uploaded session: ${filename}`,
            transcript: parsed.transcript,
          });
          const tags = [
            "shared",
            `agent:${agentSlug}`,
            `session:${sessionId}`,
            // Provenance: uploaded Claude sessions have NO agent_runs row, so
            // without this tag the contributor is unrecoverable. contributor:
            // (not user:) — user: is the twin privacy filter prefix.
            `contributor:${userId}`,
            `source:${source}-upload`,
            ...(subsystem ? [`subsystem:${subsystem}`] : []),
          ];
          // Retain in generous slices (provider chunks internally at ~3K; the
          // slices just keep individual request bodies sane for huge uploads).
          const SLICE = 150_000;
          const items = [];
          for (let i = 0; i < parsed.transcript.length; i += SLICE) {
            items.push({
              content: parsed.transcript.slice(i, i + SLICE),
              tags,
              metadata: {
                agentSlug,
                sessionId,
                source: `${source}-upload`,
                filename: filename.slice(0, 120),
                ...(subsystem ? { subsystem } : {}),
              },
            });
          }
          await memory.retain(bankId, items);
          logger.info("[memory] /upload-session transcript retained for extraction", {
            agentSlug, filename, by: userId,
            transcriptChars: parsed.transcript.length,
            slices: items.length,
            format: parsed.meta.format,
            turnCount: parsed.meta.turnCount,
            subsystem,
          });
          return;
        }

        const candidates = await distillSessionFile({ sessionId, agentSlug, userId, filename, source, rawSession: content });
        if (candidates.length === 0) {
          logger.info("[memory] /upload-session produced no candidates", { agentSlug, filename, by: userId });
          return;
        }
        const transcript: SessionTranscript = {
          sessionId,
          userId,
          agentSlug,
          orgId: agent.orgId,
          conversationId: null,
          channelId: null,
          task: `${source.charAt(0).toUpperCase() + source.slice(1)} session upload "${filename}"`,
          result: "",
          toolsUsed: [],
          toolInvocations: [],
          tokensIn: 0,
          tokensOut: 0,
          approvalStrategy: "upload",
          startedAt: now,
          completedAt: new Date(),
        };
        const reviewIds = await persistSubsystemReviews(transcript, candidates, reviewDate);
        logger.info(`[memory] /upload-session curated ${source} session`, {
          agentSlug, filename, candidatesCreated: reviewIds.length, by: userId,
        });
      } catch (err) {
        logger.error("[memory] /upload-session background processing failed", {
          agentSlug, filename, err: errMsg(err),
        });
      }
    });
  } catch (err) {
    logger.error("[memory] POST /banks/:agentSlug/upload-session failed", {
      err: errMsg(err),
    });
    if (!res.headersSent) res.status(500).json({ success: false, error: "Internal error" });
  }
});
