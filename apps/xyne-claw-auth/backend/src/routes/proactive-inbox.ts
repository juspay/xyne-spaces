import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { asyncHandler, badRequest, notFound, ok, unauthorized, HttpError } from "../lib/http.js";
import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";
import { getOrgId, getRequesterId } from "../middleware/agent-acl.js";
import { PROACTIVE, proactiveMode } from "../proactive/config.js";
import {
  ProactiveSetupError,
  deleteProactiveData,
  disableGmailSource,
  enableGmailSource,
  handleGmailPush,
} from "../proactive/sources.js";
import { dismissLoop } from "../proactive/sweep.js";

const log = createLogger("proactive-routes");

function requireUser(req: Request): { userId: string; orgId: string } {
  const userId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!userId || !orgId) throw unauthorized();
  return { userId, orgId };
}

function intInRange(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`expected an integer between ${min} and ${max}`);
  }
  return value;
}

function validTimezone(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw badRequest("timezone must be a string");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    throw badRequest("unknown timezone");
  }
}

export const proactiveInboxRouter = Router();

proactiveInboxRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = requireUser(req);
    const [sources, prefs, loops, nudges] = await Promise.all([
      prisma.inboxSource.findMany({
        where: { userId },
        select: { kind: true, address: true, enabled: true, status: true, lastSyncedAt: true, watchExpiresAt: true, lastError: true },
      }),
      prisma.proactivePrefs.findUnique({ where: { userId } }),
      prisma.openLoop.findMany({
        where: { userId, status: { in: ["open", "nudged"] } },
        orderBy: { dueAt: "asc" },
        take: 50,
        select: {
          id: true, kind: true, title: true, ask: true, counterpart: true, deadlineAt: true, dueAt: true,
          status: true, nudgeCount: true, confidence: true,
          thread: { select: { subject: true, summary: true, importance: true, lastInboundAt: true } },
        },
      }),
      prisma.nudgeLog.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, loopId: true, decision: true, reason: true, shadow: true, channel: true, sentAt: true, reaction: true, createdAt: true },
      }),
    ]);
    ok(res, { mode: proactiveMode(), sources, prefs, loops, nudges });
  }),
);

proactiveInboxRouter.post(
  "/gmail/enable",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, orgId } = requireUser(req);
    const agentId = (req.body as { agentId?: unknown } | undefined)?.agentId;
    if (agentId !== undefined && typeof agentId !== "string") throw badRequest("agentId must be a string");
    if (typeof agentId === "string") {
      const agent = await prisma.agent.findFirst({ where: { id: agentId, orgId }, select: { id: true } });
      if (!agent) throw notFound("agent not found");
    }
    try {
      const source = await enableGmailSource({ userId, orgId, agentId: agentId ?? null });
      ok(res, { enabled: true, address: source.address, watchExpiresAt: source.watchExpiresAt });
    } catch (err) {
      if (err instanceof ProactiveSetupError) {
        throw new HttpError(err.code === "google_not_connected" ? 400 : 503, err.message, err.code);
      }
      throw err;
    }
  }),
);

proactiveInboxRouter.post(
  "/gmail/disable",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = requireUser(req);
    await disableGmailSource(userId);
    ok(res, { enabled: false });
  }),
);

proactiveInboxRouter.delete(
  "/data",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = requireUser(req);
    await deleteProactiveData(userId);
    ok(res, { deleted: true });
  }),
);

proactiveInboxRouter.put(
  "/prefs",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, orgId } = requireUser(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const agentId = body["agentId"];
    if (agentId !== undefined && agentId !== null && typeof agentId !== "string") throw badRequest("agentId must be a string");
    if (typeof agentId === "string") {
      const agent = await prisma.agent.findFirst({ where: { id: agentId, orgId }, select: { id: true } });
      if (!agent) throw notFound("agent not found");
    }
    const muted = body["mutedContacts"];
    if (muted !== undefined && (!Array.isArray(muted) || muted.some((m) => typeof m !== "string") || muted.length > 500)) {
      throw badRequest("mutedContacts must be a list of strings");
    }
    const timezone = validTimezone(body["timezone"]);
    const quietStartHour = intInRange(body["quietStartHour"], 0, 23);
    const quietEndHour = intInRange(body["quietEndHour"], 0, 23);
    const maxNudgesPerDay = intInRange(body["maxNudgesPerDay"], 0, 20);
    const replySlaHours = intInRange(body["replySlaHours"], 1, 168);
    const data = {
      ...(agentId !== undefined ? { agentId: agentId as string | null } : {}),
      ...(timezone !== undefined ? { timezone } : {}),
      ...(quietStartHour !== undefined ? { quietStartHour } : {}),
      ...(quietEndHour !== undefined ? { quietEndHour } : {}),
      ...(maxNudgesPerDay !== undefined ? { maxNudgesPerDay } : {}),
      ...(replySlaHours !== undefined ? { replySlaHours } : {}),
      ...(muted !== undefined ? { mutedContacts: (muted as string[]).map((m) => m.toLowerCase()) } : {}),
    };
    const prefs = await prisma.proactivePrefs.upsert({
      where: { userId },
      create: { userId, orgId, ...data },
      update: data,
    });
    ok(res, prefs);
  }),
);

proactiveInboxRouter.post(
  "/loops/:id/dismiss",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = requireUser(req);
    const id = String(req.params["id"] ?? "");
    if (!(await dismissLoop(userId, id))) throw notFound("loop not found");
    ok(res, { dismissed: true });
  }),
);

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const gmailPushRouter = Router();

gmailPushRouter.post("/", async (req: Request, res: Response) => {
  const expected = PROACTIVE.pushToken;
  if (!expected) {
    res.status(404).end();
    return;
  }
  const given = typeof req.query["token"] === "string" ? req.query["token"] : "";
  if (!tokenMatches(given, expected)) {
    res.status(403).end();
    return;
  }
  try {
    await handleGmailPush(req.body);
    res.status(204).end();
  } catch (err) {
    log.warn(`[proactive] gmail push handling failed: ${errMsg(err)}`);
    res.status(500).end();
  }
});
