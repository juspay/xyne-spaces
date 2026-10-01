/**
 * GET /control-center/twin-reply-metrics — admin Digital-Twin "Reply activity" metrics.
 *
 * Cross-user, admin-only rollup of the twin REPLY system (distinct from the
 * per-user memory-candidate "Approval metrics"):
 *   - TwinResponseFeedback      → approvals / edits / declines / ignored +
 *                                  response time (proposed → decided).
 *   - DigitalTwinPipelineEvent  → respond/ignore GATE accepts / declines /
 *     (runType="gate")            errors, confidence, decision source.
 *   - TwinBehaviorSignal        → ground-truth responded/ignored + wrong
 *                                  silences.
 *
 * Scope: own org by default; `?orgScope=all` widens to all orgs. Window:
 * `?days=N` (preset, with prev-period deltas) OR `?from=&to=` ISO custom range.
 *
 * The twin tables are keyed by userId only (no orgId column), so org scoping
 * resolves the org's user ids first and filters `userId IN (...)`. All-orgs
 * skips the filter entirely.
 */

import { Router, type Request, type Response } from "express";
import { asyncHandler, ok } from "../lib/http.js";
import { prisma } from "../db.js";
import { requireClawAdmin } from "../middleware/agent-acl.js";
import { getAdminOrgScope, type AdminOrgScope } from "../lib/admin-org-scope.js";
import {
  computeReplyAgg,
  computeGateAgg,
  computeWeeklyTrend,
  computeBehaviorAgg,
  computePerUser,
} from "../lib/twin-reply-metrics.js";

import { createLogger } from "../logger.js";
const log = createLogger("control-center");

const router = Router();

// Bound the per-request row scan so a huge window can't blow memory. Counts are
// exact up to the cap; we log a warning (never silently truncate) if hit.
const TWIN_ROW_CAP = 50_000;
const TWIN_USER_LIMIT = 200;

function parseWindow(req: Request) {
  const date = (key: string): Date | null => {
    const raw = req.query[key];
    const d = typeof raw === "string" && raw ? new Date(raw) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  const since = date("from");
  const until = date("to");

  // Explicit custom range takes precedence; no prev-period deltas for it.
  if (since || until) return { since, until, days: null, prevSince: null, prevUntil: null };

  const days = Number(req.query["days"]);
  if (!Number.isNaN(days) && days > 0) {
    const ms = days * 24 * 60 * 60 * 1000;
    const start = new Date(Date.now() - ms);
    return { since: start, until: null, days, prevSince: new Date(start.getTime() - ms), prevUntil: start };
  }

  return { since: null, until: null, days: null, prevSince: null, prevUntil: null };
}

/** Prisma date filter for a field over [since, until). */
const dateFilter = (field: string, since: Date | null, until: Date | null): Record<string, unknown> =>
  since || until ? { [field]: { ...(since && { gte: since }), ...(until && { lt: until }) } } : {};

/** `{scope, window, ...body}` — the envelope shared by the real and the empty-org payload. */
function twinMetricsResponse(scope: AdminOrgScope, userCount: number, win: ReturnType<typeof parseWindow>, body: object) {
  return {
    scope: { orgScope: scope.allOrgs ? "all" : "org", userCount },
    window: { since: win.since?.toISOString() ?? null, until: win.until?.toISOString() ?? null, days: win.days },
    ...body,
  };
}

router.get("/twin-reply-metrics", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/control-center/twin-reply-metrics");
  const win = parseWindow(req);
  const { since, until, prevSince, prevUntil } = win;

  // Resolve the user identities we can attribute rows to (and, when org-scoped,
  // the id whitelist to filter on).
  const users = await prisma.user.findMany({
    where: scope.orgId ? { orgId: scope.orgId } : {},
    select: { id: true, name: true, email: true },
  });

  // Zero-valued payload for an org with no users (keeps the client shape stable).
  if (scope.orgId && users.length === 0) {
    ok(res, twinMetricsResponse(scope, 0, win, {
      replies: { ...computeReplyAgg([]), previousApprovalRate: null, previousEditRate: null },
      gate: { ...computeGateAgg([]), previousRespondRate: null },
      behavior: computeBehaviorAgg([]),
      byUser: [],
    }));
    return;
  }

  const userFilter = scope.orgId ? { userId: { in: users.map((u) => u.id) } } : {};

  // Only the main-period reads are ordered; the previous-period reads never were.
  const fetchReplies = (from: Date | null, to: Date | null, ordered: boolean) =>
    prisma.twinResponseFeedback.findMany({
      where: { ...userFilter, ...dateFilter("proposedAt", from, to) },
      select: { userId: true, status: true, deliveryAction: true, proposedAt: true, decidedAt: true },
      ...(ordered ? { orderBy: { proposedAt: "desc" } } : {}),
      take: TWIN_ROW_CAP,
    });
  const fetchGates = (from: Date | null, to: Date | null, ordered: boolean) =>
    prisma.digitalTwinPipelineEvent.findMany({
      where: { ...userFilter, runType: "gate", ...dateFilter("createdAt", from, to) },
      select: { userId: true, status: true, durationMs: true, trace: true },
      ...(ordered ? { orderBy: { createdAt: "desc" } } : {}),
      take: TWIN_ROW_CAP,
    });

  const [replyRows, gateRows, behaviorRows] = await Promise.all([
    fetchReplies(since, until, true),
    fetchGates(since, until, true),
    prisma.twinBehaviorSignal.findMany({
      where: { ...userFilter, ...dateFilter("occurredAt", since, until) },
      select: { userId: true, outcome: true, gateDecision: true, shouldHaveResponded: true },
      orderBy: { occurredAt: "desc" },
      take: TWIN_ROW_CAP,
    }),
  ]);

  for (const [label, rows] of [
    ["reply-feedback", replyRows],
    ["gate-events", gateRows],
    ["behavior-signals", behaviorRows],
  ] as const) {
    if (rows.length >= TWIN_ROW_CAP) {
      log.warn(`[control-center] twin-reply-metrics ${label} hit row cap ${TWIN_ROW_CAP}; totals truncated`);
    }
  }

  const allUserRows = computePerUser(users, replyRows, gateRows, behaviorRows);
  if (allUserRows.length > TWIN_USER_LIMIT) {
    log.warn(`[control-center] twin-reply-metrics returning top ${TWIN_USER_LIMIT} of ${allUserRows.length} users`);
  }

  // Previous-period deltas (preset windows only).
  let prevReply: ReturnType<typeof computeReplyAgg> | null = null;
  let prevGate: ReturnType<typeof computeGateAgg> | null = null;
  if (prevSince && prevUntil) {
    const [prevReplyRows, prevGateRows] = await Promise.all([
      fetchReplies(prevSince, prevUntil, false),
      fetchGates(prevSince, prevUntil, false),
    ]);
    prevReply = computeReplyAgg(prevReplyRows);
    prevGate = computeGateAgg(prevGateRows);
  }

  ok(res, twinMetricsResponse(scope, users.length, win, {
    replies: {
      ...computeReplyAgg(replyRows),
      previousApprovalRate: prevReply?.approvalRate ?? null,
      previousEditRate: prevReply?.editRate ?? null,
      weekly: computeWeeklyTrend(replyRows),
    },
    gate: { ...computeGateAgg(gateRows), previousRespondRate: prevGate?.respondRate ?? null },
    behavior: computeBehaviorAgg(behaviorRows),
    byUser: allUserRows.slice(0, TWIN_USER_LIMIT),
  }));
}));

export { router as twinReplyMetricsRouter };
