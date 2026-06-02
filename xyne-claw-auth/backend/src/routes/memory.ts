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
import type { Prisma } from "@prisma/client";
import { bankIdForAgent, getMemoryProvider } from "xyne-claw-shared";
import type { MemoryRecord, EntityGraphEdge } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { agentRepository } from "../repositories/index.js";
import { createLogger, createTraceId } from "../logger.js";
import { requireAuth } from "../middleware/require-auth.js";
import { curateApprovedTranscript, readSessionTranscript, backfillBatches } from "../services/memoryCronService.js";

const logger = createLogger("memory-review", createTraceId());

// All memory backend operations go through the provider abstraction.
// Default is HindsightProvider, swappable via the MEMORY_PROVIDER env var.
const memory = getMemoryProvider();

export const memoryRouter = Router();

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
        err: err instanceof Error ? err.message : String(err),
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
  if (agentSlug !== "digital-twin") return true;

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
memoryRouter.get("/reviews", requireAuth, async (req, res) => {
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

    res.json({ success: true, data: reviews });
  } catch (err) {
    logger.error("[memory] GET /reviews failed", { err: err instanceof Error ? err.message : String(err) });
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
memoryRouter.patch("/review/:id", requireAuth, async (req, res) => {
  const { action } = req.body as { action?: string };
  await handleReviewAction((req.params["id"] as string) ?? "", action ?? "", res);
});

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
        const bankId = bankIdForAgent(review.agentSlug);
        await memory.ensureBank(bankId, {
          mission: `Agent-wide subsystem memory for xyne-claw agent "${review.agentSlug}". One memory per subsystem; replaced atomically on update.`,
        });
        const tags = [
          `agent:${review.agentSlug}`,
          "shared",
          ...(review.subsystem ? [`subsystem:${review.subsystem}`] : []),
          ...(review.sessionId ? [`session:${review.sessionId}`] : []),
        ];
        const retained = await memory.retain(bankId, [
          {
            content: review.content,
            tags,
            metadata: {
              agentSlug: review.agentSlug,
              ...(review.subsystem ? { subsystem: review.subsystem } : {}),
              ...(review.sessionId ? { sessionId: review.sessionId } : {}),
              ...(review.curatorConfidence != null ? { curatorConfidence: String(review.curatorConfidence) } : {}),
              source: "curator-approved",
              action: review.action ?? "create",
            },
          },
        ]);
        newHindsightMemoryId = retained.find((r) => r.id)?.id ?? null;

        // Update: drop the replaced memory AFTER the new one is safely retained.
        // If this delete fails, we log + alert; admin will see two memories
        // tagged subsystem:X in the Memory tab and can manually clean up.
        // Order matters: retain-then-delete means we never lose the subsystem.
        if (review.action === "update" && review.replacesMemoryId) {
          try {
            await memory.deleteMemory(bankId, review.replacesMemoryId);
            logger.info("[memory] Replaced subsystem memory deleted", {
              provider: memory.name,
              reviewId,
              agentSlug: review.agentSlug,
              subsystem: review.subsystem,
              replaced: review.replacesMemoryId,
              newMemoryId: newHindsightMemoryId,
            });
          } catch (err) {
            logger.error("[memory] DUPLICATE: failed to delete replaced memory after retain — manual cleanup needed", {
              err: err instanceof Error ? err.message : String(err),
              reviewId,
              agentSlug: review.agentSlug,
              subsystem: review.subsystem,
              orphaned: review.replacesMemoryId,
              newMemoryId: newHindsightMemoryId,
            });
          }
        }

        logger.info("[memory] Subsystem memory approved and retained", {
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
          err: err instanceof Error ? err.message : String(err),
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
      err: err instanceof Error ? err.message : String(err),
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

/**
 * GET /memory/banks/:agentSlug/memories
 * Query: ?scope=user|shared&search=...&limit=50&offset=0
 *
 * Lists Hindsight's extracted memories for this agent, joined with the
 * last-7d recall-hit counts from MemoryRecallHit. Scope is inferred from
 * the memory's tags (`shared` or `user:{uid}`).
 */
memoryRouter.get("/banks/:agentSlug/memories", requireAuth, async (req, res) => {
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
    if (agentSlug === "digital-twin") {
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
    if (agentSlug === "digital-twin" && userTag) {
      const WIDE_FETCH = 500;
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
        total,
        limit: take,
        offset: skip,
        provider: memory.name,
      });
      return;
    }

    // ── Non-digital-twin banks: legacy path (provider-filtered) ────────
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
      items = items.filter((m) => (m.tags ?? []).some((t) => t.startsWith("user:")));
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
    logger.error("[memory] GET /banks/:agentSlug/memories failed", { err: err instanceof Error ? err.message : String(err) });
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
memoryRouter.get("/banks/:agentSlug/stats", requireAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    const range = (req.query["range"] as string) || "7d";
    const userTag = (req.query["userTag"] as string | undefined)?.trim();
    const days = RANGE_DAYS[range] ?? 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const bankId = bankIdForAgent(agentSlug);

    // Per-user privacy gate for the digital-twin bank — see /memories route.
    const requesterId = (req.headers["x-user-id"] as string | undefined)?.trim();
    if (agentSlug === "digital-twin") {
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
    if (agentSlug === "digital-twin" && userTag && requesterId) {
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
    const listFilter: { limit: number; offset: number; tags?: string[] } = { limit: 500, offset: 0 };
    if (userTag) listFilter.tags = [userTag];

    const [allPage, pendingBatchCount, totalRecalls, topHits] = await Promise.all([
      memory.listMemories(bankId, listFilter).catch(() => ({ memories: [], total: 0 })),
      prisma.pendingBatchReview.count({ where: { agentSlug, status: "pending" } }),
      prisma.memoryRecallHit.count({ where: { agentSlug, recalledAt: { gte: cutoff } } }),
      prisma.memoryRecallHit.groupBy({
        by: ["hindsightMemoryId"],
        where: { agentSlug, recalledAt: { gte: cutoff } },
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
    logger.error("[memory] GET /banks/:agentSlug/stats failed", { err: err instanceof Error ? err.message : String(err) });
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
memoryRouter.get("/banks/:agentSlug/subsystem-graph", requireAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    const userTag = (req.query["userTag"] as string | undefined)?.trim();
    const bankId = bankIdForAgent(agentSlug);

    // Per-user privacy gate for the digital-twin bank — see /memories route.
    const requesterId = (req.headers["x-user-id"] as string | undefined)?.trim();
    if (agentSlug === "digital-twin") {
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
    const page = (agentSlug === "digital-twin" && userTag)
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
      err: err instanceof Error ? err.message : String(err),
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
memoryRouter.get("/banks/:agentSlug/graph", requireAuth, async (req, res) => {
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
    if (agentSlug === "digital-twin" && userTag) {
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
    logger.error("[memory] GET /banks/:agentSlug/graph failed", { err: err instanceof Error ? err.message : String(err) });
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
memoryRouter.post("/banks/:agentSlug/recall", requireAuth, async (req, res) => {
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
    if (agentSlug === "digital-twin") {
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
      tags.push(`user:${userId}`);
    }

    const rawResults = await memory.recall(bankIdForAgent(agentSlug), query, {
      budget,
      ...(tags.length > 0 ? { tags } : {}),
    });
    // AUTHORITATIVE filter for digital-twin: Hindsight's tag-filter on
    // the recall path is not trusted (same incident as /memories — see
    // route comment). Drop anything the requester's user-tag isn't on.
    const results = (agentSlug === "digital-twin" && requesterId)
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
      err: err instanceof Error ? err.message : String(err),
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
memoryRouter.delete("/banks/:agentSlug/memories/:hindsightMemoryId", requireAuth, async (req, res) => {
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
      by: (req as { user?: { id?: string } }).user?.id,
    });
    res.json({ success: true });
  } catch (err) {
    logger.error("[memory] DELETE /banks/:agentSlug/memories/:hindsightMemoryId failed", {
      err: err instanceof Error ? err.message : String(err),
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
memoryRouter.get("/batches", requireAuth, async (req, res) => {
  try {
    const { agentSlug, status, limit = "20", offset = "0" } = req.query as Record<string, string>;

    // ── Digital-twin: special-case to per-user candidate clusters ───
    //
    // PendingBatchReview is the agent-memory nightly-review concept;
    // Twin doesn't use it. Twin's per-user pending work lives in the
    // userMemoryCandidate table, grouped by subsystem.  We return a
    // shape compatible with the Batches tab UI (id / status / counts)
    // so the same client renderer works for both flavours.
    if (agentSlug === "digital-twin") {
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
    const where: Record<string, unknown> = {};
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
    logger.error("[memory] GET /batches failed", { err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * GET /memory/batches/:id/spaces-action?type=approve-all|reject-all
 *
 * Spaces approve/reject button callback. Lives on a separate path so the
 * default GET /batches/:id (UI detail view) can use requireAuth cleanly.
 * No auth here — clicking the Spaces button is the auth signal for the
 * batch action.
 */
memoryRouter.get("/batches/:id/spaces-action", async (req, res) => {
  const type = req.query["type"] as string | undefined;
  if (type !== "approve-all" && type !== "reject-all") {
    res.status(400).send(htmlMessage("Invalid action — expected ?type=approve-all|reject-all", "⚠️"));
    return;
  }
  await handleBatchActionViaGet(req.params["id"] as string, type, res);
});

/**
 * GET /memory/batches/:id
 * Returns the batch + per-session previews (task, toolsUsed, tokens). UI only.
 */
memoryRouter.get("/batches/:id", requireAuth, async (req, res) => {
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
    logger.error("[memory] GET /batches/:id failed", { err: err instanceof Error ? err.message : String(err) });
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
memoryRouter.post("/batches/:id/approve", requireAuth, async (req, res) => {
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
    logger.error("[memory] POST /batches/:id/approve failed", { err: err instanceof Error ? err.message : String(err) });
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

memoryRouter.post("/recall-hits", requireAuth, async (req, res) => {
  try {
    const body = (req.body ?? {}) as { hits?: RecallHitInput[] };
    const hits = Array.isArray(body.hits) ? body.hits : [];
    if (hits.length === 0) {
      res.json({ success: true, data: { inserted: 0 } });
      return;
    }

    const rows = hits
      .filter((h) => h && h.agentSlug && h.hindsightMemoryId && h.userId && h.sessionId && h.scope && h.recalledAt)
      .map((h) => ({
        agentSlug: h.agentSlug,
        hindsightMemoryId: h.hindsightMemoryId,
        userId: h.userId,
        sessionId: h.sessionId,
        scope: h.scope,
        rank: typeof h.rank === "number" ? h.rank : null,
        recalledAt: new Date(h.recalledAt),
      }))
      .filter((r) => !Number.isNaN(r.recalledAt.getTime()));

    if (rows.length === 0) {
      res.status(400).json({ success: false, error: "No valid hits in payload" });
      return;
    }

    const result = await prisma.memoryRecallHit.createMany({ data: rows, skipDuplicates: true });
    res.json({ success: true, data: { inserted: result.count, received: hits.length } });
  } catch (err) {
    logger.error("[memory] POST /recall-hits failed", { err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * POST /memory/batches/:id/reject
 * Mark the batch rejected. No transcripts are retained.
 */
memoryRouter.post("/batches/:id/reject", requireAuth, async (req, res) => {
  try {
    const batchId = req.params["id"] as string;
    const ok = await rejectBatch(batchId);
    if (!ok) {
      res.status(404).json({ success: false, error: "Batch not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error("[memory] POST /batches/:id/reject failed", { err: err instanceof Error ? err.message : String(err) });
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
        err: err instanceof Error ? err.message : String(err),
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

async function handleBatchActionViaGet(
  batchId: string,
  action: "approve-all" | "reject-all",
  res: import("express").Response,
): Promise<void> {
  try {
    if (action === "approve-all") {
      const batch = await prisma.pendingBatchReview.findUnique({ where: { id: batchId } });
      if (!batch) {
        res.status(404).send(htmlMessage("Batch not found", "❌"));
        return;
      }
      if (batch.status !== "pending") {
        res.send(htmlMessage(`Batch already ${batch.status}. You can close this tab.`, "✅"));
        return;
      }
      startApprovalInBackground(batchId);
      res.send(
        htmlMessage(
          `Approving ${batch.sessionIds.length} sessions in the background — ` +
            `this can take several minutes. Refresh the dashboard to see progress. ` +
            `You can close this tab.`,
          "⏳",
        ),
      );
      return;
    }
    const ok = await rejectBatch(batchId);
    if (!ok) {
      res.status(404).send(htmlMessage("Batch not found", "❌"));
      return;
    }
    res.send(htmlMessage("Batch rejected — no memories were stored.", "❌"));
  } catch (err) {
    logger.error("[memory] Batch GET action failed", {
      batchId,
      action,
      err: err instanceof Error ? err.message : String(err),
    });
    res.status(500).send(htmlMessage("Internal error", "⚠️"));
  }
}

function htmlMessage(text: string, emoji: string): string {
  return (
    `<html><body style="font-family:system-ui;padding:2rem;text-align:center">` +
    `<h2>${emoji} ${text}</h2><p>You can close this tab.</p></body></html>`
  );
}

/**
 * POST /memory/banks/:agentSlug/backfill
 * Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }    (preferred)
 *   OR  { days: number }                              (legacy: today-N..today)
 *
 * Range is inclusive on both ends. Max span is 30 days.
 */
memoryRouter.post("/banks/:agentSlug/backfill", requireAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    // For digital-twin, backfill is per-user and triggered via
    // /digital-twin/enable or /digital-twin/backfill — never on the
    // shared bank surface. Block to avoid cross-user backfill triggers.
    if (agentSlug === "digital-twin") {
      res.status(403).json({
        success: false,
        error: "Use /digital-twin/enable or /digital-twin/backfill for per-user Twin backfills",
      });
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

    const summary = await backfillBatches(agentSlug, { from, to });
    logger.info("[memory] Backfill triggered", {
      agentSlug,
      by: (req as { user?: { id?: string } }).user?.id,
      ...summary,
    });
    res.json({ success: true, data: summary });
  } catch (err) {
    logger.error("[memory] POST /banks/:agentSlug/backfill failed", {
      err: err instanceof Error ? err.message : String(err),
    });
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
memoryRouter.get("/banks/:agentSlug/status", requireAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    // For digital-twin, the bank-level status (memoryEnabled flag) is a
    // shared property; per-user opt-in is the relevant signal and lives
    // under /digital-twin/status. Refuse direct reads of the bank flag
    // for this slug to keep one source of truth.
    if (agentSlug === "digital-twin") {
      res.status(403).json({
        success: false,
        error: "digital-twin bank status — use /digital-twin/status for per-user state",
      });
      return;
    }
    const agent = await agentRepository.findBySlug(agentSlug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    res.json({ success: true, data: readMemoryStatus(agent.config as Record<string, unknown> | null) });
  } catch (err) {
    logger.error("[memory] GET status failed", { err: err instanceof Error ? err.message : String(err) });
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
memoryRouter.post("/banks/:agentSlug/enable", requireAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    if (!(await checkTwinAccess(req, res, agentSlug, "bank-op"))) return;
    const body = (req.body ?? {}) as { sharedAllowed?: boolean; approvalStrategy?: string };

    const agent = await agentRepository.findBySlug(agentSlug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
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

    await agentRepository.update(agentSlug, { config: config as Prisma.InputJsonValue });

    logger.info("[memory] Agent enrolled in memory", {
      agentSlug,
      by: (req as { user?: { id?: string } }).user?.id,
      ...readMemoryStatus(config),
    });

    res.json({ success: true, data: readMemoryStatus(config) });
  } catch (err) {
    logger.error("[memory] POST enable failed", { err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

/**
 * POST /memory/banks/:agentSlug/disable
 * Flips memoryEnabled=false. Existing memories in the provider are untouched
 * (admin can purge separately). From the next session onwards, no prefetch or
 * transcript-dump fires for this agent.
 */
memoryRouter.post("/banks/:agentSlug/disable", requireAuth, async (req, res) => {
  try {
    const agentSlug = req.params["agentSlug"] as string;
    if (!(await checkTwinAccess(req, res, agentSlug, "bank-op"))) return;
    const agent = await agentRepository.findBySlug(agentSlug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    const config = { ...((agent.config as Record<string, unknown>) ?? {}) };
    config["memoryEnabled"] = false;

    await agentRepository.update(agentSlug, { config: config as Prisma.InputJsonValue });

    logger.info("[memory] Agent unenrolled from memory", {
      agentSlug,
      by: (req as { user?: { id?: string } }).user?.id,
    });

    res.json({ success: true, data: readMemoryStatus(config) });
  } catch (err) {
    logger.error("[memory] POST disable failed", { err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ success: false, error: "Internal error" });
  }
});
