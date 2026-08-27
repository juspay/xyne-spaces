/**
 * Control Center routes — admin-only operator view across all agents and runs.
 *
 * Endpoints:
 *   GET  /metrics              — stat card counts (sessions, agents, approvals, tool calls)
 *   GET  /agents               — live agent activity feed
 *   GET  /failures             — failed runs with recovery context
 *   GET  /approvals            — pending approval queue (Redis-backed)
 *   POST /approvals            — create an approval (S2S-gated, called by xyne-claw)
 *   POST /approvals/:id/approve
 *   POST /approvals/:id/reject
 *   POST /runs/:sessionId/retry   — return original run params for re-submission
 *   POST /runs/:sessionId/resolve — cancel a stuck/blocked run
 *   GET  /tasks/:sessionId/deep-link — resolve xyne-spaces URL for a run
 *   GET  /events              — SSE stream of live agent state changes
 */

import EventEmitter from "events";
import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";
import { asyncHandler, ok, badRequest } from "../lib/http.js";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { redisService } from "../redis.js";
import { requireClawAdmin, getRequesterId } from "../middleware/agent-acl.js";
import { requireS2S } from "../middleware/require-auth.js";
import { getAdminOrgScope, getOrgNameMap, withOrgLabel } from "../lib/admin-org-scope.js";
import {
  computeReplyAgg,
  computeGateAgg,
  computeBehaviorAgg,
  computePerUser,
  type ReplyFeedbackRow,
  type GateEventRow,
  type BehaviorRow,
} from "../lib/twin-reply-metrics.js";

import { createLogger } from "../logger.js";
const log = createLogger("control-center");

const router = Router();
const APPROVAL_PREFIX = "cc-approval:";
const APPROVAL_TTL_ACTIVE = 86400 * 7;   // 7 days for pending
const APPROVAL_TTL_RESOLVED = 3600;       // 1 hour for resolved (audit trail)

/* ─────────────────────────────────────────────────────────────────────
   SSE event bus
   Single Redis subscriber fans out to all connected admin clients via
   an in-memory EventEmitter so each connection doesn't need its own
   Redis subscription.
   ───────────────────────────────────────────────────────────────────── */

const ccBus = new EventEmitter();
ccBus.setMaxListeners(500);

let _subscriberReady = false;

async function ensureCCSubscriber(): Promise<void> {
  if (_subscriberReady) return;
  _subscriberReady = true;
  const sub = redisService.getConnection().duplicate();
  await sub.subscribe("cc:events");
  sub.on("message", (_ch: string, msg: string) => ccBus.emit("cc", msg));
}

/* ─────────────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────────────── */

function minutesAgo(date: Date | string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / 60000);
}

/** Map AgentRun status + currentToolLabel to the 5-state UI enum. */
function toUIStatus(
  status: string,
  currentToolLabel: string | null | undefined,
): "running" | "waiting" | "blocked" | "completed" | "failed" {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "running") {
    // If the agent is running but has been stuck on the same tool for >10 min
    // the frontend can derive "blocked" from the elapsed time. We surface
    // "waiting" when there's no active tool label (not yet started first tool).
    return currentToolLabel ? "running" : "waiting";
  }
  return "waiting";
}

/**
 * Derive initials from an agent display name.
 * "Claude PR Reviewer" → "CP"; "my-agent" → "MA"
 */
function toInitials(name: string): string {
  return name
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Build a deterministic light background from a hex color string. */
function avatarPalette(color: string): { bg: string; text: string } {
  // color is the agent's stored hex (e.g. "#6366f1"). Use it directly for text;
  // lighten it by blending with white at 20% opacity for the background.
  return { bg: color + "33", text: color };
}

function buildDeepLink(
  conversationId: string | null | undefined,
  channelId: string | null | undefined,
  triggerSource: string,
): string | null {
  // Only "spaces"-triggered runs have channelId/conversationId that are valid
  // xyne-spaces identifiers. "chat"-triggered runs store claw-auth-internal IDs.
  if (triggerSource !== "spaces") return null;
  const spacesUrl = (CONFIG as any).spacesAppUrl ?? "";
  if (!spacesUrl) return null;
  if (channelId && conversationId) return `${spacesUrl}/chat/dir/${channelId}/${conversationId}`;
  if (channelId) return `${spacesUrl}/chat/dir/${channelId}`;
  return null;
}

/* ─────────────────────────────────────────────────────────────────────
   Approval helpers
   ───────────────────────────────────────────────────────────────────── */

interface ControlCenterApproval {
  id: string;
  agentSlug: string;
  agentName: string;
  orgId?: string;
  orgName?: string | null;
  sessionId: string;
  action: string;
  targetSystem: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  minutesAgo: number;
  resolvedAt?: string;
  resolvedBy?: string;
}

async function getAllApprovals(): Promise<ControlCenterApproval[]> {
  const redis = redisService.getConnection();
  const keys = await redis.keys(`${APPROVAL_PREFIX}*`);
  if (keys.length === 0) return [];
  const values = await redis.mget(...keys);
  const approvals: ControlCenterApproval[] = [];
  for (const v of values) {
    if (!v) continue;
    try {
      const a = JSON.parse(v) as ControlCenterApproval;
      a.minutesAgo = minutesAgo(a.createdAt);
      approvals.push(a);
    } catch {}
  }
  return approvals.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

async function resolveApproval(
  id: string,
  resolution: "approved" | "rejected",
  resolvedBy: string,
): Promise<void> {
  const redis = redisService.getConnection();
  const raw = await redis.get(`${APPROVAL_PREFIX}${id}`);
  if (!raw) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
  const approval = JSON.parse(raw) as ControlCenterApproval;
  if (approval.status !== "pending") {
    throw Object.assign(new Error("ALREADY_RESOLVED"), { code: "ALREADY_RESOLVED" });
  }
  approval.status = resolution;
  approval.resolvedAt = new Date().toISOString();
  approval.resolvedBy = resolvedBy;
  await redis.set(
    `${APPROVAL_PREFIX}${id}`,
    JSON.stringify(approval),
    "EX",
    APPROVAL_TTL_RESOLVED,
  );
}

/* ─────────────────────────────────────────────────────────────────────
   GET /metrics
   ───────────────────────────────────────────────────────────────────── */

router.get("/metrics", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/control-center/metrics");
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [activeSessions, todayRuns, approvals] = await Promise.all([
    prisma.agentRun.count({ where: { status: "running", ...(scope.orgId ? { orgId: scope.orgId } : {}) } }),
    prisma.agentRun.findMany({
      where: { startedAt: { gte: todayStart }, ...(scope.orgId ? { orgId: scope.orgId } : {}) },
      select: { toolInvocations: true, agentSlug: true, status: true },
    }),
    getAllApprovals(),
  ]);

  const runningAgents = new Set(
    todayRuns.filter((r) => r.status === "running").map((r) => r.agentSlug),
  ).size;

  let toolCallsToday = 0;
  for (const run of todayRuns) {
    if (Array.isArray(run.toolInvocations)) {
      toolCallsToday += run.toolInvocations.length;
    }
  }

  const pendingApprovals = approvals.filter((a) =>
    a.status === "pending" && (scope.allOrgs || !scope.orgId || a.orgId === scope.orgId),
  ).length;

  ok(res, {
    activeSessions,
    runningAgents,
    pendingApprovals,
    toolCallsToday,
  });
}));

/* ─────────────────────────────────────────────────────────────────────
   GET /agents — live activity feed
   ───────────────────────────────────────────────────────────────────── */

router.get("/agents", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/control-center/agents");
  const limit = Math.min(parseInt((req.query["limit"] as string) || "50", 10), 200);
  const statusFilter =
    typeof req.query["status"] === "string" ? req.query["status"] : undefined;

  const runs = await prisma.agentRun.findMany({
    where: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(scope.orgId ? { orgId: scope.orgId } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: limit,
  });

  if (runs.length === 0) {
    ok(res, []);
    return;
  }

  const slugs = [...new Set(runs.map((r) => r.agentSlug))];
  const agentMeta = await prisma.agent.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, name: true, color: true },
  });
  const metaBySlug = new Map(agentMeta.map((a) => [a.slug, a]));
  const orgNames = scope.allOrgs ? await getOrgNameMap(runs.map((r) => r.orgId)) : new Map();

  const feed = runs.map((run) => {
    const meta = metaBySlug.get(run.agentSlug);
    const name = meta?.name ?? run.agentSlug;
    const palette = avatarPalette(meta?.color ?? "#6366f1");
    const invocations = Array.isArray(run.toolInvocations)
      ? (run.toolInvocations as Array<Record<string, unknown>>)
      : [];
    const lastTool =
      run.currentToolLabel ??
      (invocations.length > 0
        ? String(invocations[invocations.length - 1]?.["toolName"] ?? "")
        : run.toolsUsed.at(-1) ?? "");

    return {
      id: run.id,
      sessionId: run.sessionId,
      name,
      initials: toInitials(name),
      avatarBg: palette.bg,
      avatarText: palette.text,
      agentSlug: run.agentSlug,
      task: run.task.length > 140 ? run.task.slice(0, 140) + "…" : run.task,
      status: toUIStatus(run.status, run.currentToolLabel),
      integration: lastTool,
      startedAt: run.startedAt,
      minutesAgo: minutesAgo(run.startedAt),
      error: run.error ?? undefined,
      ...(scope.allOrgs ? withOrgLabel({ orgId: run.orgId }, orgNames) : {}),
      toolsUsed: run.toolsUsed,
      progress:
        run.status === "completed" ? 100 : run.status === "running" ? undefined : undefined,
      deepLink: buildDeepLink(run.conversationId, run.channelId, run.triggerSource),
    };
  });

  ok(res, feed);
}));

/* ─────────────────────────────────────────────────────────────────────
   GET /failures
   ───────────────────────────────────────────────────────────────────── */

router.get("/failures", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/control-center/failures");
  const limit = Math.min(parseInt((req.query["limit"] as string) || "20", 10), 100);

  const runs = await prisma.agentRun.findMany({
    where: { status: "failed", ...(scope.orgId ? { orgId: scope.orgId } : {}) },
    orderBy: { startedAt: "desc" },
    take: limit,
  });

  if (runs.length === 0) {
    ok(res, []);
    return;
  }

  const slugs = [...new Set(runs.map((r) => r.agentSlug))];
  const agentMeta = await prisma.agent.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, name: true },
  });
  const metaBySlug = new Map(agentMeta.map((a) => [a.slug, a]));
  const orgNames = scope.allOrgs ? await getOrgNameMap(runs.map((r) => r.orgId)) : new Map();

  const failures = runs.map((run) => ({
    sessionId: run.sessionId,
    agentSlug: run.agentSlug,
    ...(scope.allOrgs ? withOrgLabel({ orgId: run.orgId }, orgNames) : {}),
    agentName: metaBySlug.get(run.agentSlug)?.name ?? run.agentSlug,
    task: run.task.length > 140 ? run.task.slice(0, 140) + "…" : run.task,
    error: {
      message: run.error ?? "Unknown error",
      recoveryActions: ["retry"] as string[],
    },
    failedAt: run.completedAt ?? run.startedAt,
    deepLink: buildDeepLink(run.conversationId, run.channelId, run.triggerSource),
  }));

  ok(res, failures);
}));

/* ─────────────────────────────────────────────────────────────────────
   GET /approvals
   ───────────────────────────────────────────────────────────────────── */

router.get("/approvals", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/control-center/approvals");
  const all = await getAllApprovals();
  const filtered = scope.allOrgs || !scope.orgId ? all : all.filter((a) => a.orgId === scope.orgId);
  const orgNames = scope.allOrgs ? await getOrgNameMap(filtered.map((a) => a.orgId)) : new Map();
  ok(res, filtered.map((a) => (scope.allOrgs ? withOrgLabel(a, orgNames) : a)));
}));

/* ─────────────────────────────────────────────────────────────────────
   POST /approvals — agents write approval requests here (internal/S2S)
   ───────────────────────────────────────────────────────────────────── */

router.post("/approvals", requireS2S, asyncHandler(async (req: Request, res: Response) => {
  const { agentSlug, agentName, sessionId, action, targetSystem } = req.body as {
    agentSlug?: string;
    agentName?: string;
    orgId?: string;
    sessionId?: string;
    action?: string;
    targetSystem?: string;
  };

  if (!agentSlug || !sessionId || !action) {
    throw badRequest("agentSlug, sessionId, and action are required");
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const approval: ControlCenterApproval = {
    id,
    agentSlug,
    agentName: agentName ?? agentSlug,
    ...(typeof req.body?.orgId === "string" && req.body.orgId.trim() ? { orgId: req.body.orgId.trim() } : {}),
    sessionId,
    action,
    targetSystem: targetSystem ?? "",
    status: "pending",
    createdAt: now,
    minutesAgo: 0,
  };

  const redis = redisService.getConnection();
  await redis.set(
    `${APPROVAL_PREFIX}${id}`,
    JSON.stringify(approval),
    "EX",
    APPROVAL_TTL_ACTIVE,
  );

  res.status(201);
  ok(res, { id });
}));

/* ─────────────────────────────────────────────────────────────────────
   POST /approvals/:id/approve
   POST /approvals/:id/reject
   ───────────────────────────────────────────────────────────────────── */

router.post(
  "/approvals/:id/approve",
  requireClawAdmin,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const userId = getRequesterId(req) ?? "unknown";
      await resolveApproval(req.params.id, "approved", userId);
      res.json({ success: true });
    } catch (err: any) {
      if (err?.code === "NOT_FOUND") {
        res.status(404).json({ success: false, error: "Approval not found or expired" });
        return;
      }
      if (err?.code === "ALREADY_RESOLVED") {
        res.status(409).json({ success: false, error: "Approval already resolved" });
        return;
      }
      log.error("[control-center] approve error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

router.post(
  "/approvals/:id/reject",
  requireClawAdmin,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const userId = getRequesterId(req) ?? "unknown";
      await resolveApproval(req.params.id, "rejected", userId);
      res.json({ success: true });
    } catch (err: any) {
      if (err?.code === "NOT_FOUND") {
        res.status(404).json({ success: false, error: "Approval not found or expired" });
        return;
      }
      if (err?.code === "ALREADY_RESOLVED") {
        res.status(409).json({ success: false, error: "Approval already resolved" });
        return;
      }
      log.error("[control-center] reject error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

/* ─────────────────────────────────────────────────────────────────────
   POST /runs/:sessionId/retry
   Returns the original run parameters so the caller can re-submit via
   the normal /run endpoint. Does not auto-resubmit — the operator
   decides whether to trigger a new run.
   ───────────────────────────────────────────────────────────────────── */

router.post(
  "/runs/:sessionId/retry",
  requireClawAdmin,
  async (req: Request<{ sessionId: string }>, res: Response) => {
    try {
      const scope = getAdminOrgScope(req, "/control-center/runs/:sessionId/retry");
      const run = await prisma.agentRun.findUnique({
        where: { sessionId: req.params.sessionId },
        select: {
          orgId: true,
          agentSlug: true,
          task: true,
          conversationId: true,
          channelId: true,
          triggerSource: true,
          status: true,
        },
      });

      if (!run) {
        res.status(404).json({ success: false, error: "Run not found" });
        return;
      }
      if (!scope.allOrgs && scope.orgId && run.orgId !== scope.orgId) {
        res.status(404).json({ success: false, error: "Run not found" });
        return;
      }
      if (run.status !== "failed" && run.status !== "cancelled") {
        res
          .status(400)
          .json({ success: false, error: "Only failed or cancelled runs can be retried" });
        return;
      }

      res.json({
        success: true,
        data: {
          agentSlug: run.agentSlug,
          task: run.task,
          conversationId: run.conversationId,
          channelId: run.channelId,
          triggerSource: run.triggerSource,
        },
      });
    } catch (err) {
      log.error("[control-center] retry error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

/* ─────────────────────────────────────────────────────────────────────
   POST /runs/:sessionId/resolve — cancel a stuck/blocked run in the DB.
   Note: this updates the DB record. Killing the live agent process is a
   separate infrastructure concern handled by the session eviction queue.
   ───────────────────────────────────────────────────────────────────── */

router.post(
  "/runs/:sessionId/resolve",
  requireClawAdmin,
  async (req: Request<{ sessionId: string }>, res: Response) => {
    try {
      const scope = getAdminOrgScope(req, "/control-center/runs/:sessionId/resolve");
      const run = await prisma.agentRun.findUnique({
        where: { sessionId: req.params.sessionId },
        select: { status: true, orgId: true },
      });

      if (!run) {
        res.status(404).json({ success: false, error: "Run not found" });
        return;
      }
      if (!scope.allOrgs && scope.orgId && run.orgId !== scope.orgId) {
        res.status(404).json({ success: false, error: "Run not found" });
        return;
      }
      if (run.status !== "running") {
        res
          .status(400)
          .json({ success: false, error: "Only running (blocked/waiting) runs can be resolved" });
        return;
      }

      await prisma.agentRun.updateMany({
        where: { sessionId: req.params.sessionId },
        data: { status: "cancelled", completedAt: new Date(), currentToolLabel: null },
      });

      res.json({ success: true });
    } catch (err) {
      log.error("[control-center] resolve error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

/* ─────────────────────────────────────────────────────────────────────
   GET /tasks/:sessionId/deep-link
   ───────────────────────────────────────────────────────────────────── */

router.get(
  "/tasks/:sessionId/deep-link",
  requireClawAdmin,
  async (req: Request<{ sessionId: string }>, res: Response) => {
    try {
      const scope = getAdminOrgScope(req, "/control-center/tasks/:sessionId/deep-link");
      const run = await prisma.agentRun.findUnique({
        where: { sessionId: req.params.sessionId },
        select: { conversationId: true, channelId: true, triggerSource: true, orgId: true },
      });

      if (!run) {
        res.status(404).json({ success: false, error: "Run not found" });
        return;
      }
      if (!scope.allOrgs && scope.orgId && run.orgId !== scope.orgId) {
        res.status(404).json({ success: false, error: "Run not found" });
        return;
      }

      const url = buildDeepLink(run.conversationId, run.channelId, run.triggerSource);
      res.json({
        success: true,
        data: {
          url,
          spaceId: url ? "xyne-spaces" : null,
          sessionId: req.params.sessionId,
        },
      });
    } catch (err) {
      log.error("[control-center] deep-link error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

/* ─────────────────────────────────────────────────────────────────────
   GET /events — SSE stream of live agent state changes
   Publishes are fired by agent-chat.ts on every tool progress event,
   run start, and run completion. Clients re-fetch /agents on receipt
   to get the authoritative DB snapshot.
   ───────────────────────────────────────────────────────────────────── */

router.get("/events", requireClawAdmin, async (req: Request, res: Response) => {
  await ensureCCSubscriber();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Keepalive ping every 25s to prevent proxy/load-balancer timeouts.
  const keepalive = setInterval(() => res.write(":ping\n\n"), 25_000);
  const listener = (msg: string) => res.write(`data: ${msg}\n\n`);
  ccBus.on("cc", listener);

  req.on("close", () => {
    clearInterval(keepalive);
    ccBus.off("cc", listener);
  });
});

/* ─────────────────────────────────────────────────────────────────────
   GET /twin-reply-metrics — admin Digital-Twin "Reply activity" metrics.

   Cross-user, admin-only rollup of the twin REPLY system (distinct from the
   per-user memory-candidate "Approval metrics"):
     - TwinResponseFeedback      → approvals / edits / declines / ignored +
                                    response time (proposed → decided).
     - DigitalTwinPipelineEvent  → respond/ignore GATE accepts / declines /
       (runType="gate")            errors, confidence, decision source.
     - TwinBehaviorSignal        → ground-truth responded/ignored + wrong
                                    silences.

   Scope: own org by default; `?orgScope=all` widens to all orgs. Window:
   `?days=N` (preset, with prev-period deltas) OR `?from=&to=` ISO custom range.

   The twin tables are keyed by userId only (no orgId column), so org scoping
   resolves the org's user ids first and filters `userId IN (...)`. All-orgs
   skips the filter entirely.
   ───────────────────────────────────────────────────────────────────── */

// Bound the per-request row scan so a huge window can't blow memory. Counts are
// exact up to the cap; we log a warning (never silently truncate) if hit.
const TWIN_ROW_CAP = 50_000;
const TWIN_USER_LIMIT = 200;

function parseWindow(req: Request): {
  since: Date | null;
  until: Date | null;
  days: number | null;
  prevSince: Date | null;
  prevUntil: Date | null;
} {
  const fromRaw = typeof req.query["from"] === "string" ? req.query["from"] : "";
  const toRaw = typeof req.query["to"] === "string" ? req.query["to"] : "";
  const fromDate = fromRaw ? new Date(fromRaw) : null;
  const toDate = toRaw ? new Date(toRaw) : null;
  const validFrom = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null;
  const validTo = toDate && !Number.isNaN(toDate.getTime()) ? toDate : null;

  // Explicit custom range takes precedence; no prev-period deltas for it.
  if (validFrom || validTo) {
    return { since: validFrom, until: validTo, days: null, prevSince: null, prevUntil: null };
  }

  const daysParam = Number(req.query["days"]);
  if (!Number.isNaN(daysParam) && daysParam > 0) {
    const ms = daysParam * 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - ms);
    return {
      since,
      until: null,
      days: daysParam,
      prevSince: new Date(since.getTime() - ms),
      prevUntil: since,
    };
  }

  return { since: null, until: null, days: null, prevSince: null, prevUntil: null };
}

/** Prisma date filter for a field over [since, until). */
function dateFilter(
  field: string,
  since: Date | null,
  until: Date | null,
): Record<string, unknown> {
  if (!since && !until) return {};
  const range: Record<string, Date> = {};
  if (since) range["gte"] = since;
  if (until) range["lt"] = until;
  return { [field]: range };
}

router.get("/twin-reply-metrics", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/control-center/twin-reply-metrics");
  const { since, until, days, prevSince, prevUntil } = parseWindow(req);

  // Resolve the user identities we can attribute rows to (and, when org-scoped,
  // the id whitelist to filter on).
  const users = await prisma.user.findMany({
    where: scope.orgId ? { orgId: scope.orgId } : {},
    select: { id: true, name: true, email: true },
  });

  if (scope.orgId && users.length === 0) {
    ok(res, emptyTwinReplyMetrics(scope, since, until, days));
    return;
  }

  const orgUserIds = users.map((u) => u.id);
  const userFilter = scope.orgId ? { userId: { in: orgUserIds } } : {};

  const [replyRowsRaw, gateRowsRaw, behaviorRowsRaw] = await Promise.all([
    prisma.twinResponseFeedback.findMany({
      where: { ...userFilter, ...dateFilter("proposedAt", since, until) },
      select: { userId: true, status: true, deliveryAction: true, proposedAt: true, decidedAt: true },
      orderBy: { proposedAt: "desc" },
      take: TWIN_ROW_CAP,
    }),
    prisma.digitalTwinPipelineEvent.findMany({
      where: { ...userFilter, runType: "gate", ...dateFilter("createdAt", since, until) },
      select: { userId: true, status: true, durationMs: true, trace: true },
      orderBy: { createdAt: "desc" },
      take: TWIN_ROW_CAP,
    }),
    prisma.twinBehaviorSignal.findMany({
      where: { ...userFilter, ...dateFilter("occurredAt", since, until) },
      select: { userId: true, outcome: true, gateDecision: true, shouldHaveResponded: true },
      orderBy: { occurredAt: "desc" },
      take: TWIN_ROW_CAP,
    }),
  ]);

  for (const [label, rows] of [
    ["reply-feedback", replyRowsRaw],
    ["gate-events", gateRowsRaw],
    ["behavior-signals", behaviorRowsRaw],
  ] as const) {
    if (rows.length >= TWIN_ROW_CAP) {
      log.warn(`[control-center] twin-reply-metrics ${label} hit row cap ${TWIN_ROW_CAP}; totals truncated`);
    }
  }

  const replyRows = replyRowsRaw as ReplyFeedbackRow[];
  const gateRows = gateRowsRaw as GateEventRow[];
  const behaviorRows = behaviorRowsRaw as BehaviorRow[];

  const replies = computeReplyAgg(replyRows);
  const gate = computeGateAgg(gateRows);
  const behavior = computeBehaviorAgg(behaviorRows);

  const allUserRows = computePerUser(users, replyRows, gateRows, behaviorRows);
  const byUser = allUserRows.slice(0, TWIN_USER_LIMIT);
  if (allUserRows.length > TWIN_USER_LIMIT) {
    log.warn(`[control-center] twin-reply-metrics returning top ${TWIN_USER_LIMIT} of ${allUserRows.length} users`);
  }

  // Previous-period deltas (preset windows only).
  let previousApprovalRate: number | null = null;
  let previousEditRate: number | null = null;
  let previousRespondRate: number | null = null;
  if (prevSince && prevUntil) {
    const [prevReplyRaw, prevGateRaw] = await Promise.all([
      prisma.twinResponseFeedback.findMany({
        where: { ...userFilter, ...dateFilter("proposedAt", prevSince, prevUntil) },
        select: { userId: true, status: true, deliveryAction: true, proposedAt: true, decidedAt: true },
        take: TWIN_ROW_CAP,
      }),
      prisma.digitalTwinPipelineEvent.findMany({
        where: { ...userFilter, runType: "gate", ...dateFilter("createdAt", prevSince, prevUntil) },
        select: { userId: true, status: true, durationMs: true, trace: true },
        take: TWIN_ROW_CAP,
      }),
    ]);
    const prevReply = computeReplyAgg(prevReplyRaw as ReplyFeedbackRow[]);
    const prevGate = computeGateAgg(prevGateRaw as GateEventRow[]);
    previousApprovalRate = prevReply.approvalRate;
    previousEditRate = prevReply.editRate;
    previousRespondRate = prevGate.respondRate;
  }

  ok(res, {
    scope: {
      orgScope: scope.allOrgs ? "all" : "org",
      userCount: users.length,
    },
    window: {
      since: since ? since.toISOString() : null,
      until: until ? until.toISOString() : null,
      days,
    },
    replies: { ...replies, previousApprovalRate, previousEditRate },
    gate: { ...gate, previousRespondRate },
    behavior,
    byUser,
  });
}));

/** Zero-valued payload for an org with no users (keeps the client shape stable). */
function emptyTwinReplyMetrics(
  scope: { allOrgs: boolean },
  since: Date | null,
  until: Date | null,
  days: number | null,
): unknown {
  return {
    scope: { orgScope: scope.allOrgs ? "all" : "org", userCount: 0 },
    window: {
      since: since ? since.toISOString() : null,
      until: until ? until.toISOString() : null,
      days,
    },
    replies: {
      ...computeReplyAgg([]),
      previousApprovalRate: null,
      previousEditRate: null,
    },
    gate: { ...computeGateAgg([]), previousRespondRate: null },
    behavior: computeBehaviorAgg([]),
    byUser: [],
  };
}

export { router as controlCenterRouter };
