/**
 * Scheduled jobs — CRUD + result callback.
 *
 * POST   /scheduled-jobs           — create a scheduled job
 * GET    /scheduled-jobs            — list jobs (filter by userId, status)
 * GET    /scheduled-jobs/:id        — get single job
 * DELETE /scheduled-jobs/:id        — cancel a job
 * POST   /scheduled-jobs/:id/result — callback from xyne-claw after scheduled run
 */

import { Router, type Request, type Response } from "express";
import { errMsg } from "../lib/errors.js";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { decrypt } from "../crypto.js";
import { agentRunRepository, chatMessageRepository } from "../repositories/index.js";
import { spacesAppFetch, spacesAppFetchMultipart } from "../lib/spaces-api.js";
import { getRequesterId, getOrgId, isClawAdmin } from "../middleware/agent-acl.js";
import { assertCanControlScheduledJob } from "./scheduled-jobs-auth.js";
import { requireStrictS2S } from "../middleware/require-auth.js";
import { getSpacesAuthForUser, getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { expandSpacesMentions, resolveUnboundMentions } from "../lib/mention-transform.js";
import { buildSpacesMentionLookups, buildSpacesMentionLookupsDb } from "../lib/mention-lookups.js";
import {
  enqueueDelayedJob,
  enqueueCronJob,
  cancelJob,
  cancelCronJob,
  type ScheduledJobData,
} from "../queue/scheduled-jobs-queue.js";
import { handleRunCompletion, handleRunHandoff } from "../queue/run-recovery-worker.js";
import { isDashboardTask, refreshScheduledDashboardShare } from "../services/dashboardShareRefreshService.js";
import { designShareUrl } from "./design-shares.js";
// cron-parser v4 is CJS (`module.exports = CronParser`). Node's native ESM
// loader can't statically detect named exports from that pattern, so a
// `import { parseExpression } from "cron-parser"` throws at runtime even
// though the .d.ts file claims the export exists. Default-import the
// module object and pull the static method off it.
import cronParser from "cron-parser";

import { asyncHandler, ok, badRequest, unauthorized, forbidden, notFound, HttpError } from "../lib/http.js";

import { createLogger } from "../logger.js";
const log = createLogger("scheduled-jobs");
const { parseExpression } = cronParser;

const router = Router();

/**
 * Read the `xyne_last_workspace` cookie to determine which Spaces workspace
 * the request is scoped to. Used to capture workspaceId on scheduled-job
 * create so we can pass it to Spaces' app API at result-delivery time.
 */
function readWorkspaceCookie(req: Request): string | undefined {
  const cookie = req.headers.cookie ?? "";
  const match = cookie.match(/(?:^|;\s*)xyne_last_workspace=([^;]*)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

// ── Cron validation ─────────────────────────────────────────────────
//
// Shared by POST (create) and PATCH (reschedule). Two checks:
//   1. Parseability via cron-parser (5-field standard, IST tz). Bullmq
//      uses the same parser, so anything that fails here would later
//      fail in upsertJobScheduler — better to reject up-front with a
//      structured 400 instead of a thrown 500.
//   2. Minimum-interval policy. Reads CONFIG.minCronIntervalMinutes
//      (env: MIN_CRON_INTERVAL_MINUTES, default 30). Blocks bare `*`
//      and `*/N` where N is smaller than the configured floor — both
//      would let users burn LLM quota by firing far too often.
function validateCronExpression(
  expr: string,
): { ok: true; cron: string } | { ok: false; error: string } {
  const trimmed = expr.trim();
  if (!trimmed) {
    return { ok: false, error: "cronExpression is required" };
  }
  try {
    parseExpression(trimmed, { tz: "Asia/Kolkata" }).next();
  } catch (err) {
    return {
      ok: false,
      error: `Invalid cronExpression: ${errMsg(err)}`,
    };
  }

  const minInterval = CONFIG.minCronIntervalMinutes;
  if (minInterval > 0) {
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 1) {
      const minuteField = parts[0]!;
      if (minuteField === "*") {
        return {
          ok: false,
          error: `Minimum cron interval is ${minInterval} minutes. Use '*/${minInterval} * * * *' or longer.`,
        };
      }
      const stepMatch = minuteField.match(/^\*\/(\d+)$/);
      if (stepMatch && parseInt(stepMatch[1]!, 10) < minInterval) {
        return {
          ok: false,
          error: `Minimum cron interval is ${minInterval} minutes. Got every ${stepMatch[1]} minutes.`,
        };
      }
    }
  }

  return { ok: true, cron: trimmed };
}

// ── Auth helpers ────────────────────────────────────────────────────

/**
 * Resolve the userId filter to apply for list/read operations.
 *
 * - Browser requests (JWT cookie or x-user-id header): always scoped to the requester.
 *   Admins may pass `?userId=<other>` to look at someone else's jobs.
 * - S2S requests (no requesterId set): no implicit filter; the caller decides.
 */
async function resolveScopedUserId(
  req: Request,
  explicitUserId?: string,
): Promise<string | undefined> {
  const requesterId = getRequesterId(req);
  if (!requesterId) return explicitUserId; // S2S — trust caller
  if (explicitUserId && explicitUserId !== requesterId) {
    if (await isClawAdmin(requesterId)) return explicitUserId;
    return requesterId; // non-admin attempting cross-user read — clamp to self
  }
  return requesterId;
}

// ── Helpers ──────────────────────────────────────────────────────────

function decryptStoredField(stored: string): string {
  const [ciphertext, iv, authTag] = stored.split(":");
  if (!ciphertext || !iv || !authTag) throw new Error("Invalid encrypted field format");
  return decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
}

function isSessionLockedError(error?: string | null): boolean {
  return error === "session_locked" || error?.includes("session_locked") === true;
}

function nextFireText(row: { type: string; nextRunAt: Date | null; cronExpression: string | null; status: string }): string | null {
  if (row.status !== "active") return null;
  if (row.nextRunAt) return row.nextRunAt.toISOString();
  if (row.type === "cron" && row.cronExpression) {
    try {
      return parseExpression(row.cronExpression, { tz: "Asia/Kolkata" }).next().toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

async function postScheduledFailureNotice(row: {
  id: string;
  userId: string;
  agentSlug: string;
  orgId: string;
  channelId: string | null;
  conversationId: string | null;
  workspaceId: string | null;
  replyMode: string;
  targetChannelId: string | null;
  type: string;
  nextRunAt: Date | null;
  cronExpression: string | null;
  status: string;
}, error: string | null | undefined): Promise<void> {
  const agent = await prisma.agent.findFirst({
    where: { slug: row.agentSlug, orgId: row.orgId },
  });
  if (!agent?.spacesAppToken || !agent.spacesAppId) {
    log.error(`[scheduled-jobs/result] Agent ${row.agentSlug} has no Spaces app credentials for failure notice`);
    return;
  }

  let effectiveWorkspaceId = row.workspaceId;
  if (!effectiveWorkspaceId) {
    effectiveWorkspaceId = await getWorkspaceIdForUser(row.userId, "scheduled-job").catch(() => null);
  }
  if (!effectiveWorkspaceId) {
    log.error(`[scheduled-jobs/result] Job ${row.id}: missing workspaceId for failure notice`);
    return;
  }

  const next = nextFireText(row);
  const message = [
    `⚠️ Scheduled run failed: ${error?.trim() || "unknown error"}.`,
    ...(next ? [`Next run: ${next}.`] : []),
  ].join("\n");
  const appToken = decryptStoredField(agent.spacesAppToken);
  const spacesAppUserId = agent.spacesAppUserId ?? "";

  if (row.replyMode === "channel" && (row.targetChannelId || row.channelId)) {
    await spacesAppFetch("/chat/postMessage", {
      channelId: row.targetChannelId ?? row.channelId!,
      markdownText: message,
      userId: spacesAppUserId,
      workspaceId: effectiveWorkspaceId,
      metadata: { contentFormat: "markdown" },
    }, appToken);
    return;
  }

  if (row.channelId && row.conversationId) {
    await spacesAppFetch("/chat/postMessage", {
      channelId: row.channelId,
      conversationId: row.conversationId,
      markdownText: message,
      userId: spacesAppUserId,
      workspaceId: effectiveWorkspaceId,
      metadata: { contentFormat: "markdown" },
    }, appToken);
    return;
  }

  const dmResult = (await spacesAppFetch("/channel/openDm", {
    targetUserId: row.userId,
    workspaceId: effectiveWorkspaceId,
  }, appToken)) as { channelId: string };
  await spacesAppFetch("/chat/postMessage", {
    channelId: dmResult.channelId,
    markdownText: message,
    userId: spacesAppUserId,
    workspaceId: effectiveWorkspaceId,
    metadata: { contentFormat: "markdown" },
  }, appToken);
}

// ── POST / — create a scheduled job ─────────────────────────────────

router.post("/", asyncHandler(async (req: Request, res: Response) => {
  const {
    userId: bodyUserId, agentSlug, task, context,
    channelId, conversationId,
    type, delayMs, cronExpression,
    label, maxRuns, replyMode,
    workspaceId: bodyWorkspaceId,
  } = req.body as {
    userId?: string;
    agentSlug?: string;
    task?: string;
    context?: string;
    channelId?: string;
    conversationId?: string;
    type?: string;
    delayMs?: number;
    cronExpression?: string;
    label?: string;
    maxRuns?: number;
    replyMode?: string;
    workspaceId?: string;
  };

  // Spaces' app API requires workspaceId on postMessage / openDm. Capture
  // it now so the result handler can pass it through later. Priority:
  //   1. Body (S2S callers may pass explicitly)
  //   2. `xyne_last_workspace` cookie (browser flow)
  //   3. Spaces DB live read (works even when neither of the above is set —
  //      common for non-browser triggers or when the cookie can't cross
  //      the claw / spaces domain boundary)
  let workspaceId: string | undefined = bodyWorkspaceId?.trim() || readWorkspaceCookie(req);

  // Force userId from the authed requester; only S2S (no requesterId) or admins
  // can create jobs owned by someone else.
  const requesterId = getRequesterId(req);
  const userId = requesterId
    ? (bodyUserId && bodyUserId !== requesterId && (await isClawAdmin(requesterId))
        ? bodyUserId
        : requesterId)
    : bodyUserId;

  if (!userId || !agentSlug || !task || !type) {
    throw badRequest("userId, agentSlug, task, and type are required");
  }

  // S2S callers (the runtime's schedule-task tool) send only the S2S key +
  // body userId — no x-user-id header, so requireAuth attaches no org
  // context. Derive the org from the job owner instead (User.orgId is
  // required and 1:1), same pattern as the other S2S entry points.
  let requestOrgId = getOrgId(req);
  if (!requestOrgId) {
    const owner = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } }).catch(() => null);
    requestOrgId = owner?.orgId ?? undefined;
  }
  if (!requestOrgId) {
    log.error(`[scheduled-jobs/create] orgId is required userId=${userId} requesterId=${requesterId ?? "none"} bodyUserId=${bodyUserId ?? "none"} agentSlug=${agentSlug} channelId=${channelId ?? "none"} conversationId=${conversationId ?? "none"} workspaceId=${workspaceId ?? "none"} type=${type}`);
    throw badRequest("orgId is required");
  }
  const agent = await prisma.agent.findFirst({
    where: { slug: agentSlug, orgId: requestOrgId },
    select: { orgId: true },
  });
  if (!agent) {
    log.warn(`[scheduled-jobs/create] agent org-scoped miss slug=${agentSlug} orgId=${requestOrgId ?? "none"} userId=${userId}`);
    throw notFound("Agent not found");
  }

  // Fallback: pull workspaceId from the user's active Spaces session row.
  // Most browser callers don't currently send it in the body, and the
  // `xyne_last_workspace` cookie can be absent in non-browser triggers.
  // Without this fallback the row gets workspaceId=NULL and Spaces rejects
  // the result-delivery call when the job fires.
  if (!workspaceId) {
    const live = await getSpacesAuthForUser(userId, "scheduled-job");
    if (live?.workspaceId) {
      workspaceId = live.workspaceId;
      log.info(`[scheduled-jobs] resolved workspaceId=${workspaceId} from Spaces session for userId=${userId}`);
    }
  }

  // Final fallback: read workspaceId straight off the user row (no live
  // session required). getSpacesAuthForUser only resolves for currently
  // logged-in users, so reminders typed hours earlier / S2S / automation
  // triggers previously fell through to a NULL workspaceId — and Spaces then
  // silently rejected result delivery when the job fired ("missing
  // workspaceId on row"). The user row always carries the workspaceId.
  if (!workspaceId) {
    const wsId = await getWorkspaceIdForUser(userId, "scheduled-job");
    if (wsId) {
      workspaceId = wsId;
      log.info(`[scheduled-jobs] resolved workspaceId=${workspaceId} from users row for userId=${userId}`);
    } else {
      log.warn(`[scheduled-jobs] no workspaceId from body/cookie/session/usersRow for userId=${userId} — row will be created with NULL and result delivery will fail`);
    }
  }

  if (type !== "once" && type !== "cron") {
    throw badRequest("type must be 'once' or 'cron'");
  }

  if (type === "once" && (delayMs == null || delayMs <= 0)) {
    throw badRequest("delayMs is required and must be > 0 for type='once'");
  }

  if (type === "cron" && !cronExpression) {
    throw badRequest("cronExpression is required for type='cron'");
  }

  // Validate parseability + min-interval policy. Shared with PATCH.
  let normalizedCron: string | undefined;
  if (type === "cron" && cronExpression) {
    const v = validateCronExpression(cronExpression);
    if (!v.ok) {
      throw badRequest(v.error);
    }
    normalizedCron = v.cron;
  }

  const nextRunAt = type === "once" ? new Date(Date.now() + delayMs!) : null;

  // Create Prisma row
  const row = await prisma.scheduledJob.create({
    data: {
      userId,
      agentSlug,
      task,
      context: context ?? null,
      channelId: channelId ?? null,
      conversationId: conversationId ?? null,
      type,
      delayMs: type === "once" ? BigInt(delayMs!) : null,
      cronExpression: type === "cron" ? (normalizedCron ?? null) : null,
      maxRuns: maxRuns ?? (type === "once" ? 1 : null),
      nextRunAt,
      label: label ?? null,
      workspaceId: workspaceId ?? null,
      replyMode: replyMode ?? "thread",
      orgId: agent.orgId,
    },
  });

  const data: ScheduledJobData = {
    scheduledJobId: row.id,
    userId,
    agentSlug,
    task,
    context: context ?? undefined,
    channelId: channelId ?? undefined,
    conversationId: conversationId ?? undefined,
  };

  // Enqueue in BullMQ
  if (type === "once") {
    const bullJobId = await enqueueDelayedJob(data, delayMs!);
    await prisma.scheduledJob.update({
      where: { id: row.id },
      data: { bullJobId },
    });
  } else {
    const schedulerId = `cron-${row.id}`;
    await enqueueCronJob(schedulerId, data, normalizedCron!);
    await prisma.scheduledJob.update({
      where: { id: row.id },
      data: { bullSchedulerId: schedulerId },
    });
  }

  log.info(`[scheduled-jobs] Created ${type} job ${row.id} for agent ${agentSlug}`);

  ok(res, {
    id: row.id,
    type: row.type,
    status: row.status,
    nextRunAt: nextRunAt?.toISOString(),
    cronExpression: row.cronExpression,
    label: row.label,
  });
}));

// ── GET / — list jobs ───────────────────────────────────────────────

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const { userId: qUserId, status, agentSlug } = req.query as { userId?: string; status?: string; agentSlug?: string };
  const userId = await resolveScopedUserId(req, qUserId);
  const where: Record<string, unknown> = {};
  if (userId) where["userId"] = userId;
  if (status) where["status"] = status;
  if (agentSlug) where["agentSlug"] = agentSlug;

  const rows = await prisma.scheduledJob.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  ok(res, rows.map((r) => ({
    ...r,
    delayMs: r.delayMs != null ? Number(r.delayMs) : null,
  })));
}));

// ── GET /runs — list runs across jobs (filter by agentSlug) ─────────

router.get("/runs", asyncHandler(async (req: Request, res: Response) => {
  const { agentSlug, userId: qUserId } = req.query as { agentSlug?: string; userId?: string };
  if (!agentSlug) {
    throw badRequest("agentSlug is required");
  }

  const userId = await resolveScopedUserId(req, qUserId);
  const jobWhere: Record<string, unknown> = { agentSlug };
  if (userId) jobWhere["userId"] = userId;

  const jobIds = await prisma.scheduledJob.findMany({
    where: jobWhere,
    select: { id: true },
  });

  const runs = await prisma.scheduledJobRun.findMany({
    where: { scheduledJobId: { in: jobIds.map((j) => j.id) } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      scheduledJob: {
        select: { label: true, task: true, cronExpression: true },
      },
    },
  });

  ok(res, runs);
}));

// ── GET /:id — get single job ───────────────────────────────────────

router.get("/:id", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const row = await prisma.scheduledJob.findUnique({ where: { id: req.params.id } });
  if (!row) {
    throw notFound("Not found");
  }
  // Require a resolved requester identity. On the browser path requireAuth
  // overwrites x-user-id with the verified Spaces session id, so this is the
  // authenticated caller. A bare `if (requesterId && ...)` guard SKIPPED the
  // ownership check whenever x-user-id was absent, letting an identity-less
  // caller read/reschedule ANY job. Match DELETE: no requester => 401;
  // non-owner (and non-admin) => 404.
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized("Authentication required");
  }
  if (row.userId !== requesterId && !(await isClawAdmin(requesterId))) {
    throw notFound("Not found");
  }
  ok(res, { ...row, delayMs: row.delayMs != null ? Number(row.delayMs) : null });
}));

// ── PATCH /:id — update editable fields on a job ────────────────────
//
// Owner (or admin) can change display/delivery options AND, for active cron
// jobs, the cron expression itself. Rescheduling a cron job re-binds the
// BullMQ scheduler in Redis to the new pattern (still tz="Asia/Kolkata"
// per scheduled-jobs-queue.ts). delayMs / agentSlug / type remain
// non-editable — those should go through delete + recreate.

router.patch("/:id", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const row = await prisma.scheduledJob.findUnique({ where: { id: req.params.id } });
  if (!row) {
    throw notFound("Not found");
  }
  // Require a resolved requester identity. On the browser path requireAuth
  // overwrites x-user-id with the verified Spaces session id, so this is the
  // authenticated caller. A bare `if (requesterId && ...)` guard SKIPPED the
  // ownership check whenever x-user-id was absent, letting an identity-less
  // caller read/reschedule ANY job. Match DELETE: no requester => 401;
  // non-owner (and non-admin) => 404.
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized("Authentication required");
  }
  if (row.userId !== requesterId && !(await isClawAdmin(requesterId))) {
    throw notFound("Not found");
  }

  const { replyMode, label, targetChannelId, cronExpression, nextRunAt, task, context } = req.body as {
    replyMode?: string;
    label?: string | null;
    targetChannelId?: string | null;
    cronExpression?: string;
    nextRunAt?: string;
    task?: string;
    context?: string | null;
  };

  const data: {
    replyMode?: string;
    label?: string | null;
    targetChannelId?: string | null;
    cronExpression?: string;
    delayMs?: bigint;
    nextRunAt?: Date;
    task?: string;
    context?: string | null;
  } = {};
  if (replyMode !== undefined) {
    if (replyMode !== "thread" && replyMode !== "channel") {
      throw badRequest("replyMode must be 'thread' or 'channel'");
    }
    data.replyMode = replyMode;
  }
  if (label !== undefined) {
    data.label = label === null ? null : String(label);
  }
  if (targetChannelId !== undefined) {
    // Empty string / null clears the override (revert to originating channel).
    const trimmed = targetChannelId == null ? null : String(targetChannelId).trim();
    data.targetChannelId = trimmed && trimmed.length > 0 ? trimmed : null;
  }

  if (task !== undefined) {
    // task is the agent instruction executed on every fire (NOT NULL column).
    // The worker reads it live from the row, so an edit takes effect on the
    // next run with no Redis re-bind. Reject empty/whitespace so a job can't
    // be silently turned into a no-op.
    const trimmed = String(task).trim();
    if (trimmed.length === 0) {
      throw badRequest("task cannot be empty");
    }
    data.task = trimmed;
  }
  if (context !== undefined) {
    // Empty string / null clears the additional context.
    const trimmed = context == null ? null : String(context).trim();
    data.context = trimmed && trimmed.length > 0 ? trimmed : null;
  }

  let cronChanged = false;
  if (cronExpression !== undefined) {
    if (row.type !== "cron") {
      throw badRequest("cronExpression can only be changed on type='cron' jobs");
    }
    if (row.status !== "active") {
      throw badRequest("Only active jobs can be rescheduled");
    }
    // Same parseability + min-interval policy as POST. validateCronExpression
    // returns the trimmed value on success.
    const v = validateCronExpression(String(cronExpression));
    if (!v.ok) {
      throw badRequest(v.error);
    }
    if (v.cron !== row.cronExpression) {
      data.cronExpression = v.cron;
      cronChanged = true;
    }
  }

  let onceRescheduled = false;
  let newDelayMsForRescheduledOnce = 0;
  if (nextRunAt !== undefined) {
    if (row.type !== "once") {
      throw badRequest("nextRunAt can only be changed on type='once' jobs");
    }
    if (row.status !== "active") {
      throw badRequest("Only active jobs can be rescheduled");
    }
    const newDate = new Date(String(nextRunAt));
    if (isNaN(newDate.getTime())) {
      throw badRequest("nextRunAt must be a valid ISO datetime (e.g. '2026-05-26T19:30:00Z')");
    }
    const newDelayMs = newDate.getTime() - Date.now();
    // 5s floor so a clock-skew race between client/server doesn't push
    // the new schedule into the past on submit.
    if (newDelayMs < 5_000) {
      throw badRequest("nextRunAt must be at least 5 seconds in the future");
    }
    data.nextRunAt = newDate;
    data.delayMs = BigInt(newDelayMs);
    onceRescheduled = true;
    newDelayMsForRescheduledOnce = newDelayMs;
  }

  if (Object.keys(data).length === 0) {
    throw badRequest("No editable fields supplied");
  }

  const updated = await prisma.scheduledJob.update({ where: { id: row.id }, data });

  // Re-bind the BullMQ scheduler so the new pattern actually takes effect
  // in Redis. upsertJobScheduler is idempotent — re-registering the same
  // schedulerId with a new pattern atomically replaces it.
  if (cronChanged) {
    const schedulerId = updated.bullSchedulerId ?? `cron-${updated.id}`;
    const jobData: ScheduledJobData = {
      scheduledJobId: updated.id,
      userId: updated.userId,
      agentSlug: updated.agentSlug,
      task: updated.task,
      ...(updated.context ? { context: updated.context } : {}),
      ...(updated.channelId ? { channelId: updated.channelId } : {}),
      ...(updated.conversationId ? { conversationId: updated.conversationId } : {}),
    };
    try {
      await enqueueCronJob(schedulerId, jobData, updated.cronExpression!);
      if (!updated.bullSchedulerId) {
        await prisma.scheduledJob.update({
          where: { id: updated.id },
          data: { bullSchedulerId: schedulerId },
        });
      }
      log.info(`[scheduled-jobs] Rescheduled ${updated.id} → '${updated.cronExpression}'`);
    } catch (err) {
      log.error(`[scheduled-jobs] Failed to re-bind scheduler ${schedulerId}:`, err);
      // DB is already updated — surface the Redis failure so the caller
      // knows the binding may be stale and can retry.
      throw new HttpError(500, `Saved cron in DB but failed to update Redis scheduler: ${errMsg(err)}`);
    }
  }

  // Once-job reschedule: cancel the prior BullMQ delayed job (if still
  // pending) and re-enqueue with the new delay. Cancel is best-effort —
  // if the old job already fired or was already cleaned up, ignore.
  if (onceRescheduled) {
    if (updated.bullJobId) {
      await cancelJob(updated.bullJobId).catch((err) => {
        log.warn(`[scheduled-jobs] Failed to cancel old bullJob ${updated.bullJobId} for ${updated.id}:`, err instanceof Error ? err.message : err);
      });
    }
    const jobData: ScheduledJobData = {
      scheduledJobId: updated.id,
      userId: updated.userId,
      agentSlug: updated.agentSlug,
      task: updated.task,
      ...(updated.context ? { context: updated.context } : {}),
      ...(updated.channelId ? { channelId: updated.channelId } : {}),
      ...(updated.conversationId ? { conversationId: updated.conversationId } : {}),
    };
    try {
      const newBullJobId = await enqueueDelayedJob(jobData, newDelayMsForRescheduledOnce);
      await prisma.scheduledJob.update({
        where: { id: updated.id },
        data: { bullJobId: newBullJobId },
      });
      log.info(`[scheduled-jobs] Rescheduled once-job ${updated.id} → fires at ${updated.nextRunAt?.toISOString()} (delay ${newDelayMsForRescheduledOnce}ms)`);
    } catch (err) {
      log.error(`[scheduled-jobs] Failed to re-enqueue once-job ${updated.id}:`, err);
      // DB is ahead of Redis. The next fire won't happen until the user
      // retries the reschedule. Surface this so the caller knows.
      throw new HttpError(500, `Saved nextRunAt in DB but failed to enqueue the new delayed job: ${errMsg(err)}`);
    }
  }

  ok(res, { ...updated, delayMs: updated.delayMs != null ? Number(updated.delayMs) : null });
}));

// ── DELETE /:id — cancel a job ──────────────────────────────────────

// ── POST /:id/pause — pause an active job (unbind from BullMQ, keep row) ──

router.post(
  "/:id/pause",
  asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const row = await prisma.scheduledJob.findUnique({
      where: { id: req.params.id },
    });
    if (!row) {
      throw notFound("Not found");
    }

    const auth = await assertCanControlScheduledJob(req, row);
    if (auth.ok === false) {
      throw new HttpError(auth.status, auth.error);
    }

    if (row.status === "paused") {
      ok(res, { id: row.id, status: row.status });
      return;
    }
    if (row.status !== "active") {
      throw badRequest(`Only active jobs can be paused (current status: ${row.status})`);
    }

    if (row.type === "once" && row.bullJobId) {
      await cancelJob(row.bullJobId).catch((err) => {
        log.warn(
          `[scheduled-jobs] Failed to remove delayed job ${row.bullJobId} while pausing ${row.id}:`,
          err instanceof Error ? err.message : err,
        );
      });
    }
    if (row.type === "cron" && row.bullSchedulerId) {
      await cancelCronJob(row.bullSchedulerId).catch((err) => {
        log.warn(
          `[scheduled-jobs] Failed to remove scheduler ${row.bullSchedulerId} while pausing ${row.id}:`,
          err instanceof Error ? err.message : err,
        );
      });
    }

    const updated = await prisma.scheduledJob.update({
      where: { id: row.id },
      data: { status: "paused" },
    });

    log.info(`[scheduled-jobs] Paused job ${row.id} by ${auth.actorUserId}`);
    ok(res, { id: updated.id, status: updated.status });
  }),
);

// ── POST /:id/resume — resume a paused job (re-bind to BullMQ) ────────────

router.post(
  "/:id/resume",
  asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const row = await prisma.scheduledJob.findUnique({
      where: { id: req.params.id },
    });
    if (!row) {
      throw notFound("Not found");
    }

    const auth = await assertCanControlScheduledJob(req, row);
    if (auth.ok === false) {
      throw new HttpError(auth.status, auth.error);
    }

    if (row.status === "active") {
      ok(res, { id: row.id, status: row.status });
      return;
    }
    if (row.status !== "paused") {
      throw badRequest(`Only paused jobs can be resumed (current status: ${row.status})`);
    }

    const jobData: ScheduledJobData = {
      scheduledJobId: row.id,
      userId: row.userId,
      agentSlug: row.agentSlug,
      task: row.task,
      ...(row.context ? { context: row.context } : {}),
      ...(row.channelId ? { channelId: row.channelId } : {}),
      ...(row.conversationId ? { conversationId: row.conversationId } : {}),
    };
    let updateData: {
      status: string;
      bullJobId?: string;
      bullSchedulerId?: string;
      nextRunAt?: Date;
      delayMs?: bigint;
    } = { status: "active" };

    if (row.type === "cron") {
      if (!row.cronExpression) {
        throw badRequest("Cannot resume cron job without cronExpression");
      }
      const schedulerId = row.bullSchedulerId ?? `cron-${row.id}`;
      await enqueueCronJob(schedulerId, jobData, row.cronExpression);
      updateData = { ...updateData, bullSchedulerId: schedulerId };
    } else if (row.type === "once") {
      const targetRunAt =
        row.nextRunAt && row.nextRunAt.getTime() > Date.now() + 5_000
          ? row.nextRunAt
          : new Date(Date.now() + 5_000);
      const delayMs = targetRunAt.getTime() - Date.now();
      const bullJobId = await enqueueDelayedJob(jobData, delayMs);
      updateData = {
        ...updateData,
        bullJobId,
        nextRunAt: targetRunAt,
        delayMs: BigInt(delayMs),
      };
    } else {
      throw badRequest(`Unknown scheduled job type: ${row.type}`);
    }

    const updated = await prisma.scheduledJob.update({
      where: { id: row.id },
      data: updateData,
    });

    log.info(`[scheduled-jobs] Resumed job ${row.id} by ${auth.actorUserId}`);
    ok(res, {
      id: updated.id,
      status: updated.status,
      nextRunAt: updated.nextRunAt?.toISOString(),
    });
  }),
);

// ── POST /:id/cancel — tool-friendly cancel (mirrors DELETE, keeps row) ───

router.post(
  "/:id/cancel",
  asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const row = await prisma.scheduledJob.findUnique({
      where: { id: req.params.id },
    });
    if (!row) {
      throw notFound("Not found");
    }

    const auth = await assertCanControlScheduledJob(req, row);
    if (auth.ok === false) {
      throw new HttpError(auth.status, auth.error);
    }

    if (row.status === "cancelled") {
      ok(res, { id: row.id, status: row.status });
      return;
    }
    if (row.status === "completed") {
      throw badRequest("Completed jobs cannot be cancelled");
    }

    if (row.type === "once" && row.bullJobId) {
      await cancelJob(row.bullJobId).catch(() => {});
    }
    if (row.type === "cron" && row.bullSchedulerId) {
      await cancelCronJob(row.bullSchedulerId).catch(() => {});
    }

    const updated = await prisma.scheduledJob.update({
      where: { id: row.id },
      data: { status: "cancelled" },
    });

    log.info(
      `[scheduled-jobs] Cancelled job ${row.id} by ${auth.actorUserId}`,
    );
    ok(res, { id: updated.id, status: updated.status });
  }),
);

// ── POST /:id/update — edit the prompt/task (and label) of a job ──────
//
// Companion to PATCH /:id for the S2S / agent path. PATCH authenticates via
// getRequesterId (browser session) and 401s an identity-less caller; the
// scheduled-job-control tool instead posts userId+agentSlug over S2S. Reuse
// assertCanControlScheduledJob so an agent can only edit its OWN job (owner +
// agent clamp, plus the currentScheduledJobId clamp when it runs inside one).
// Because the worker reads task/context live from the row, no Redis re-bind is
// needed — this is a pure DB write that the next fire picks up.
router.post(
  "/:id/update",
  asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const row = await prisma.scheduledJob.findUnique({
      where: { id: req.params.id },
    });
    if (!row) {
      throw notFound("Not found");
    }

    const auth = await assertCanControlScheduledJob(req, row);
    if (auth.ok === false) {
      throw new HttpError(auth.status, auth.error);
    }

    const { task, context, label } = req.body as {
      task?: string;
      context?: string | null;
      label?: string | null;
    };

    const data: { task?: string; context?: string | null; label?: string | null } = {};
    if (task !== undefined) {
      const trimmed = String(task).trim();
      if (trimmed.length === 0) {
        throw badRequest("task cannot be empty");
      }
      data.task = trimmed;
    }
    if (context !== undefined) {
      const trimmed = context == null ? null : String(context).trim();
      data.context = trimmed && trimmed.length > 0 ? trimmed : null;
    }
    if (label !== undefined) {
      data.label = label === null ? null : String(label);
    }

    if (Object.keys(data).length === 0) {
      throw badRequest("No editable fields supplied (task, context, label)");
    }

    const updated = await prisma.scheduledJob.update({
      where: { id: row.id },
      data,
    });

    log.info(
      `[scheduled-jobs] Updated task/context on job ${row.id} by ${auth.actorUserId}`,
    );
    ok(res, { id: updated.id, status: updated.status });
  }),
);

router.delete("/:id", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const row = await prisma.scheduledJob.findUnique({ where: { id: req.params.id } });
  if (!row) {
    throw notFound("Not found");
  }
  // Delete is restricted to the job owner or a CLAW_ADMIN — S2S callers
  // can't delete jobs on behalf of users.
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized("Authentication required");
  }
  if (row.userId !== requesterId && !(await isClawAdmin(requesterId))) {
    throw notFound("Not found");
  }

  // Remove from BullMQ
  if (row.type === "once" && row.bullJobId) {
    await cancelJob(row.bullJobId).catch(() => {});
  }
  if (row.type === "cron" && row.bullSchedulerId) {
    await cancelCronJob(row.bullSchedulerId).catch(() => {});
  }

  await prisma.scheduledJob.update({
    where: { id: row.id },
    data: { status: "cancelled" },
  });

  log.info(`[scheduled-jobs] Cancelled job ${row.id}`);
  ok(res);
}));

// ── POST /:id/result — callback from xyne-claw after scheduled run ──

// S2S-only: this is the run-result callback from xyne-claw. The router is
// mounted under requireAuth (which accepts a browser cookie) for job
// management, so without this an ordinary logged-in user could POST a forged
// result that posts a message as the agent into the job owner's channel.
router.post("/:id/result", requireStrictS2S, async (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params;
  const payload = req.body as {
    sessionId?: string;
    userId?: string;
    status?: string;
    result?: string;
    error?: string;
    toolsUsed?: string[];
    toolInvocations?: unknown;
    tokenUsage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
    provider?: string;
    model?: string;
    lastTurn?: number;
  };

  log.info(`[scheduled-jobs/result] Job ${id}: status=${payload.status}`);
  res.json({ success: true });
  let resultChatMessageId: string | null = null;

  if (payload.status === "handoff") {
    log.info(`[scheduled-jobs/result] Job ${id}: handoff callback session=${payload.sessionId ?? ""} lastTurn=${payload.lastTurn ?? "unknown"}`);
    if (payload.sessionId) {
      const handoff = await handleRunHandoff(payload.sessionId).catch((err) => {
        log.warn(`[scheduled-jobs/result] handoff re-dispatch failed for ${payload.sessionId}:`, errMsg(err));
        return null;
      });
      if (handoff) {
        log.info(`[scheduled-jobs/result] Job ${id}: handoff re-dispatched root=${handoff.rootSessionId} newSession=${handoff.newSessionId}`);
      } else {
        log.warn(`[scheduled-jobs/result] Job ${id}: handoff callback had no recovery state session=${payload.sessionId}`);
      }
    }
    return;
  }

  // Finalize AgentRun + save assistant ChatMessage (fire-and-forget)
  if (payload.sessionId) {
    const status = payload.status === "completed" ? "completed" : "failed";
    agentRunRepository.finalize(payload.sessionId, {
      status,
      result: payload.result ?? null,
      error: payload.error ?? null,
      ...(payload.provider !== undefined ? { provider: payload.provider } : {}),
      ...(payload.model !== undefined ? { model: payload.model } : {}),
      ...(payload.toolsUsed ? { toolsUsed: payload.toolsUsed } : {}),
      ...(payload.toolInvocations !== undefined ? { toolInvocations: payload.toolInvocations } : {}),
      ...(payload.tokenUsage ? { tokenUsage: payload.tokenUsage } : {}),
    }).catch(() => {});

    if (payload.result?.trim() || payload.attachments?.length) {
      const run = await agentRunRepository.findBySessionId(payload.sessionId).catch(() => null);
      if (run?.conversationId && run.agentSlug && run.userId) {
        const message = await chatMessageRepository.create({
          conversationId: run.conversationId,
          agentSlug: run.agentSlug,
          userId: run.userId,
          role: "assistant",
          content: payload.result ?? "",
          status: "completed",
          orgId: run.orgId ?? null,
        }).catch((err) => {
          log.warn(`[scheduled-jobs/result] Job ${id}: failed to persist assistant message:`, err instanceof Error ? err.message : err);
          return null;
        });
        resultChatMessageId = message?.id ?? null;
      }
    }
  }

  // Persist run result — find existing run by sessionId or create new
  try {
    if (payload.sessionId) {
      const updated = await prisma.scheduledJobRun.updateMany({
        where: { scheduledJobId: id, sessionId: payload.sessionId },
        data: {
          status: payload.status ?? "unknown",
          result: payload.result ?? null,
          error: payload.error ?? null,
          completedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        await prisma.scheduledJobRun.create({
          data: {
            scheduledJobId: id,
            sessionId: payload.sessionId,
            status: payload.status ?? "unknown",
            result: payload.result ?? null,
            error: payload.error ?? null,
            completedAt: new Date(),
          },
        });
      }
    } else {
      await prisma.scheduledJobRun.create({
        data: {
          scheduledJobId: id,
          status: payload.status ?? "unknown",
          result: payload.result ?? null,
          error: payload.error ?? null,
          completedAt: new Date(),
        },
      });
    }
  } catch (err) {
    log.error(`[scheduled-jobs/result] Failed to persist run for job ${id}:`, err);
  }

  const row = await prisma.scheduledJob.findUnique({ where: { id } });
  if (!row) {
    log.warn(`[scheduled-jobs/result] Job ${id} not found`);
    return;
  }

  let dashboardShareAnnouncement: string | null = null;
  if (payload.status === "completed" && isDashboardTask(row.task) && resultChatMessageId) {
    try {
      const refreshed = await refreshScheduledDashboardShare({
        task: row.task,
        chatMessageId: resultChatMessageId,
        ownerUserId: row.userId,
        orgId: row.orgId,
        conversationId: row.conversationId,
        attachments: payload.attachments,
      });
      if (refreshed.share) {
        const share = refreshed.share;
        if (share.linkChanged) {
          const link = designShareUrl(share.sharePath);
          dashboardShareAnnouncement = `🔗 **Live dashboard:** ${link}\nThe same link updates after each successful refresh.`;
        }
        log.info(`[scheduled-jobs/result] Job ${id}: refreshed dashboard share=${share.id} conversation=${row.conversationId}`);
      } else {
        log.warn(`[scheduled-jobs/result] Job ${id}: /dashboard share not refreshed reason=${refreshed.reason}`);
      }
    } catch (err) {
      log.warn(`[scheduled-jobs/result] Job ${id}: dashboard share refresh failed:`, err instanceof Error ? err.message : err);
    }
  }

  if (payload.sessionId && payload.status === "completed") {
    await handleRunCompletion(payload.sessionId, "completed").catch((err) => {
      log.warn(`[scheduled-jobs/result] handleRunCompletion completed failed for ${payload.sessionId}:`, err instanceof Error ? err.message : err);
    });
  } else if (payload.sessionId) {
    const recoveryFailure = await handleRunCompletion(payload.sessionId, "failed", payload.error ?? payload.status ?? "failed").catch((err) => {
      log.warn(`[scheduled-jobs/result] handleRunCompletion failed for ${payload.sessionId}:`, err instanceof Error ? err.message : err);
      return null;
    });
    if (recoveryFailure?.retried) {
      log.info(`[scheduled-jobs/result] Job ${id}: failure queued recovery retry (${recoveryFailure.retriesUsed}/${recoveryFailure.maxRetries})`);
      return;
    }
    // Lock contention is transient (the original run is still holding the
    // conversation's session lock) — recovery defers/queues it; never alarm
    // the thread with a failure notice. Only reachable without recovery
    // state (recovery handles it above via retried:true) or after deferral
    // exhaustion, which recovery reports separately.
    if (isSessionLockedError(payload.error)) {
      log.info(`[metric] name=scheduled_run_outcome status=deferred agent=${row.agentSlug} job=${id}`);
      log.info(`[scheduled-jobs/result] Job ${id}: session_locked — deferred, no failure notice`);
      return;
    }
  }

  const finalizedStatus = payload.status === "completed" ? "completed" : "failed";
  log.info(`[metric] name=scheduled_run_outcome status=${finalizedStatus} agent=${row.agentSlug} job=${id}`);

  if (payload.status !== "completed") {
    // Genuine failure (recovery exhausted or not retryable) — tell the thread.
    await postScheduledFailureNotice(row, payload.error ?? payload.status).catch((err) => {
      log.warn(`[scheduled-jobs/result] Job ${id}: failed to post failure notice:`, err instanceof Error ? err.message : err);
    });
    return;
  }
  if (!payload.result && !payload.attachments?.length) {
    // Completed with nothing to deliver — not a failure; do not alarm the thread.
    log.info(`[scheduled-jobs/result] Job ${id}: completed with empty result — nothing to post`);
    return;
  }

  // Resolve agent's Spaces app token scoped to the job's org.
  const agent = await prisma.agent.findFirst({
    where: { slug: row.agentSlug, orgId: row.orgId },
  });
  if (!agent?.spacesAppToken || !agent.spacesAppId) {
    log.error(`[scheduled-jobs/result] Agent ${row.agentSlug} has no Spaces app credentials`);
    return;
  }

  const appToken = decryptStoredField(agent.spacesAppToken);
  const spacesAppUserId = agent.spacesAppUserId ?? "";
  let effectiveWorkspaceId = row.workspaceId;

  if (!effectiveWorkspaceId) {
    const resolvedWorkspaceId = await getWorkspaceIdForUser(row.userId, "scheduled-job");
    if (resolvedWorkspaceId) {
      await prisma.scheduledJob.update({
        where: { id: row.id },
        data: { workspaceId: resolvedWorkspaceId },
      });
      effectiveWorkspaceId = resolvedWorkspaceId;
      log.info(`[scheduled-jobs/result] Job ${id}: backfilled workspaceId=${resolvedWorkspaceId} from Spaces user row`);
    }
  }

  // Deterministic tagging for scheduled results. This path used to post
  // payload.result raw, so agent-emitted mentions (`@bowmitha.c`,
  // `@Name[userId]`, even full HTML-span output) never became real,
  // notifying Spaces mentions — only the webhook result path ran the
  // mention pipeline. Resolve plain `@Name` / `@email` / `@dotted.handle`
  // shorthand against Spaces using the job creator's session (the scheduled
  // run acts on their behalf), then expand to the HTML span format. Both
  // steps degrade gracefully: no session → bracketed forms still expand;
  // lookup misses → text left as-is.
  let resultText = payload.result ?? "";
  try {
    const senderAuth = row.userId
      ? await getSpacesAuthForUser(row.userId, "scheduled-job").catch(() => null)
      : null;
    if (senderAuth?.token) {
      resultText = await resolveUnboundMentions(
        resultText,
        buildSpacesMentionLookups({
          token: senderAuth.token,
          sessionId: senderAuth.sessionId,
          workspaceId: senderAuth.workspaceId,
        }),
      );
    } else {
      resultText = await resolveUnboundMentions(
        resultText,
        buildSpacesMentionLookupsDb(effectiveWorkspaceId ?? undefined),
      );
      log.info(`[scheduled-jobs/result] Job ${id}: resolved mentions via Spaces DB fallback for creator ${row.userId ?? "(none)"}`);
    }
  } catch (err) {
    log.warn(`[scheduled-jobs/result] Job ${id}: mention resolution failed, posting unresolved text:`, err instanceof Error ? err.message : err);
  }
  resultText = expandSpacesMentions(resultText);
  if (dashboardShareAnnouncement) {
    resultText = resultText.trim()
      ? `${resultText.trim()}\n\n${dashboardShareAnnouncement}`
      : dashboardShareAnnouncement;
  }

  try {
    // Spaces' app API requires `workspaceId` on postMessage and openDm. We
    // capture it at job-creation time (scheduled_jobs.workspaceId). Rows
    // created before that column existed have null workspaceId — surface a
    // clear error so the user knows to recreate the job.
    if (!effectiveWorkspaceId) {
      log.error(`[scheduled-jobs/result] Job ${id}: missing workspaceId on row — Spaces will reject delivery. Recreate the job.`);
      return;
    }

    if (row.replyMode === "channel" && (row.targetChannelId || row.channelId)) {
      // Top-level channel post — no conversationId, new message in channel.
      // Prefer the explicit `targetChannelId` override (set by the user in the
      // Scheduled Jobs UI). Falls back to the originating channelId if not set.
      // Always pass workspaceId — Spaces' postMessage requires it.
      const postChannelId = row.targetChannelId ?? row.channelId!;
      if (payload.attachments?.length) {
        const form = new FormData();
        for (const att of payload.attachments) {
          const buffer = Buffer.from(att.data, "base64");
          const blob = new Blob([buffer], { type: att.mimeType });
          form.append("files", blob, att.fileName);
        }
        form.append("channelId", postChannelId);
        form.append("userId", spacesAppUserId);
        form.append("workspaceId", effectiveWorkspaceId);
        form.append("markdownText", resultText);
        form.append("metadata", JSON.stringify({ contentFormat: "markdown" }));

        await spacesAppFetchMultipart("/files/filesUpload", form, appToken);
      } else {
        await spacesAppFetch("/chat/postMessage", {
          channelId: postChannelId,
          markdownText: resultText,
          userId: spacesAppUserId,
          workspaceId: effectiveWorkspaceId,
          metadata: { contentFormat: "markdown" },
        }, appToken);
      }

      log.info(`[scheduled-jobs/result] Posted result to channel ${postChannelId}${row.targetChannelId ? " (override)" : ""}`);
    } else if (row.channelId && row.conversationId) {
      // Reply in the original thread (default "thread" mode)
      if (payload.attachments?.length) {
        const form = new FormData();
        for (const att of payload.attachments) {
          const buffer = Buffer.from(att.data, "base64");
          const blob = new Blob([buffer], { type: att.mimeType });
          form.append("files", blob, att.fileName);
        }
        form.append("channelId", row.channelId);
        form.append("conversationId", row.conversationId);
        form.append("userId", spacesAppUserId);
        form.append("workspaceId", effectiveWorkspaceId);
        form.append("markdownText", resultText);
        form.append("metadata", JSON.stringify({ contentFormat: "markdown" }));

        await spacesAppFetchMultipart("/files/filesUpload", form, appToken);
      } else {
        await spacesAppFetch("/chat/postMessage", {
          channelId: row.channelId,
          conversationId: row.conversationId,
          markdownText: resultText,
          userId: spacesAppUserId,
          workspaceId: effectiveWorkspaceId,
          metadata: { contentFormat: "markdown" },
        }, appToken);
      }

      log.info(`[scheduled-jobs/result] Posted result to thread ${row.conversationId}`);
    } else if (row.userId) {
      // DM the user
      const dmResult = (await spacesAppFetch("/channel/openDm", {
        targetUserId: row.userId,
        workspaceId: effectiveWorkspaceId,
      }, appToken)) as { channelId: string };

      await spacesAppFetch("/chat/postMessage", {
        channelId: dmResult.channelId,
        markdownText: resultText,
        userId: spacesAppUserId,
        workspaceId: effectiveWorkspaceId,
        metadata: { contentFormat: "markdown" },
      }, appToken);

      log.info(`[scheduled-jobs/result] DM'd result to user ${row.userId}`);
    }
  } catch (err) {
    log.error(`[scheduled-jobs/result] Failed to deliver result for job ${id}:`, err);
  }
});

export { router as scheduledJobsRouter };
