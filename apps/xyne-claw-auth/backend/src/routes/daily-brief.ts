import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { getRequesterId, getOrgId, isClawAdmin, isOrgAdmin , requireRequester} from "../middleware/agent-acl.js";
import { asyncHandler, ok, badRequest, unauthorized, forbidden } from "../lib/http.js";
import { createLogger } from "../logger.js";
import { CONFIG } from "../config.js";
import {
  userAgentInstructionRepository,
  generatedContentRepository,
  DAILY_BRIEF_KIND,
} from "../repositories/index.js";
import {
  generateDailyBrief,
  briefDateBucket,
  renderBriefMarkdown,
  resolveBriefAgentSlug,
  DAILY_BRIEF_SLUG,
  type DailyBriefPayload,
} from "../services/dailyBrief.js";
import {
  recordDailyBriefOptInChange,
  recordDailyBriefRegeneration,
  recordDailyBriefSwitch,
  recordDailyBriefViewed,
  type BriefSwitchSource,
} from "../otel/daily-brief-metrics.js";

const log = createLogger("daily-brief-routes");
const MAX_INSTRUCTIONS = 8000;

const router = Router();

/** GET /config — the user's Daily Brief enable flag + custom instructions. */
router.get("/config", asyncHandler(async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!userId || !orgId) throw unauthorized();
  const [user, instruction] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { dailyBriefEnabled: true } }),
    userAgentInstructionRepository.findByUserAndAgent(userId, orgId, DAILY_BRIEF_SLUG),
  ]);
  ok(res, {
    enabled: user?.dailyBriefEnabled ?? false,
    instructions: instruction?.instructions ?? "",
    instructionsEnabled: instruction ? instruction.enabled : true,
    updatedAt: instruction?.updatedAt ?? null,
  });
}));

/** PUT /config — toggle the brief on/off and/or set custom instructions. */
router.put("/config", asyncHandler(async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!userId || !orgId) throw unauthorized();
  const body = req.body as {
    enabled?: unknown;
    instructions?: unknown;
    instructionsEnabled?: unknown;
  };

  if (body.instructionsEnabled !== undefined && typeof body.instructionsEnabled !== "boolean") {
    throw badRequest("instructionsEnabled must be a boolean");
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      throw badRequest("enabled must be a boolean");
    }
    const before = await prisma.user
      .findUnique({ where: { id: userId }, select: { dailyBriefEnabled: true } })
      .catch(() => null);
    await prisma.user.update({
      where: { id: userId },
      data: {
        dailyBriefEnabled: body.enabled,
        ...(body.enabled ? { dailyBriefEnabledAt: new Date() } : {}),
      },
    });
    if (before && before.dailyBriefEnabled !== body.enabled) {
      recordDailyBriefOptInChange(body.enabled);
    }
  }

  if (body.instructions !== undefined || body.instructionsEnabled !== undefined) {
    if (
      body.instructions !== undefined &&
      body.instructions !== null &&
      typeof body.instructions !== "string"
    ) {
      throw badRequest("instructions must be a string or null");
    }
    const data: { instructions?: string; enabled?: boolean } = {
      // Absent instructionsEnabled keeps the historical write-enables behaviour.
      enabled: typeof body.instructionsEnabled === "boolean" ? body.instructionsEnabled : true,
    };
    if (body.instructions !== undefined) {
      data.instructions =
        typeof body.instructions === "string" ? body.instructions.slice(0, MAX_INSTRUCTIONS) : "";
    }
    await userAgentInstructionRepository.upsert(userId, orgId, DAILY_BRIEF_SLUG, data);
  }

  const [user, instruction] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { dailyBriefEnabled: true } }),
    userAgentInstructionRepository.findByUserAndAgent(userId, orgId, DAILY_BRIEF_SLUG),
  ]);
  ok(res, {
    enabled: user?.dailyBriefEnabled ?? false,
    instructions: instruction?.instructions ?? "",
    instructionsEnabled: instruction ? instruction.enabled : true,
    updatedAt: instruction?.updatedAt ?? null,
  });
}));

/** GET /latest — today's stored brief (falls back to the most recent one). */
router.get("/latest", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const orgId = getOrgId(req);
  const today = briefDateBucket();
  const todays = await generatedContentRepository.findForBucket(userId, DAILY_BRIEF_KIND, today);
  const row = todays ?? (await generatedContentRepository.findLatest(userId, DAILY_BRIEF_KIND));
  if (!row) {
    ok(res, { status: "none" });
    return;
  }
  if (orgId) void recordDailyBriefViewed(userId, orgId, today);
  ok(res, {
    status: row.status,
    date: row.dateBucket,
    content: row.content,
    data: row.data,
    generatedAt: row.generatedAt,
    isToday: row.dateBucket === today,
  });
}));

/** GET /history — the user's recent briefs, newest first (for the history list). */
router.get("/history", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 30;
  const rows = await generatedContentRepository.findHistory(userId, DAILY_BRIEF_KIND, limit);
  ok(res, rows.map((row) => ({
    date: row.dateBucket,
    status: row.status,
    content: row.content,
    data: row.data,
    agentSlug: row.agentSlug,
    generatedAt: row.generatedAt,
  })));
}));

/** GET /dates — every day the user has a brief for, newest first (date + status, no content). */
router.get("/dates", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), 1000)
    : 365;
  const rows = await generatedContentRepository.findDateBuckets(userId, DAILY_BRIEF_KIND, limit);
  ok(res, rows.map((row) => ({ date: row.dateBucket, status: row.status })));
}));

/** GET /by-date/:date — the stored brief for one YYYY-MM-DD bucket. */
router.get("/by-date/:date", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const date = String(req.params.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("date must be YYYY-MM-DD");
  const row = await generatedContentRepository.findForBucket(userId, DAILY_BRIEF_KIND, date);
  if (!row) {
    ok(res, { status: "none", date });
    return;
  }
  ok(res, {
    status: row.status,
    date: row.dateBucket,
    content: row.content,
    data: row.data,
    agentSlug: row.agentSlug,
    generatedAt: row.generatedAt,
    isToday: row.dateBucket === briefDateBucket(),
  });
}));

/**
 * POST /switched — beacon for "this user switched to another brief". The screen
 * holds the recent window in memory, so most switches never hit the server and
 * cannot be inferred from any other route.
 */
router.post("/switched", async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    const orgId = getOrgId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    // Coerced, not validated: `source` is client-supplied and lands on a metric
    // label, so an unknown value must collapse into a known one rather than
    // open the label up to arbitrary cardinality.
    const body = req.body as { source?: unknown };
    const source: BriefSwitchSource = body.source === "date_picker" ? "date_picker" : "history_menu";
    if (orgId) await recordDailyBriefSwitch(userId, orgId, source, briefDateBucket());
    res.status(204).end();
  } catch (err) {
    log.error("[daily-brief] post switched", err);
    res.status(500).json({ success: false, error: "Failed to record brief switch" });
  }
});

/**
 * POST /regenerate — (SSE) re-run the brief now, streaming progress, and overwrite
 * today's stored brief. Emits: `start`, `progress` (label), `complete` (brief +
 * markdown), or `error`.
 */
router.post("/regenerate", async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Abort the underlying run if the client disconnects.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  const dateBucket = briefDateBucket();
  // Read the row BEFORE generateDailyBrief flips it to "generating", otherwise
  // there is no way to tell a rejected brief from a retry after a failure.
  const existing = await generatedContentRepository
    .findForBucket(userId, DAILY_BRIEF_KIND, dateBucket)
    .catch(() => null);
  const attempt = orgId
    ? await recordDailyBriefRegeneration(userId, orgId, dateBucket, existing)
    : 1;
  send("start", { date: dateBucket });
  try {
    const result = await generateDailyBrief(userId, {
      signal: abort.signal,
      trigger: "regenerate",
      attempt,
      onProgress: (label) => send("progress", { label }),
    });
    if (result) {
      send("complete", { brief: result.brief satisfies DailyBriefPayload, content: result.content });
    } else {
      send("error", { message: "Could not generate the brief. Please try again." });
    }
  } catch (err) {
    log.error("[daily-brief] regenerate", err);
    send("error", { message: err instanceof Error ? err.message : "Regeneration failed" });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

/**
 * GET /settings — which agent runs this org's brief + the pickable agents.
 * Readable by any authenticated user (informational). Returns the effective slug
 * (resolved override→default), the raw org override (null if unset), the
 * deployment default, and the org's enabled agents for a picker.
 */
router.get("/settings", asyncHandler(async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!userId || !orgId) throw unauthorized();
  const [org, agents, effective] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { dailyBriefAgentSlug: true } }),
    prisma.agent.findMany({
      where: { orgId, enabled: true },
      select: { slug: true, name: true },
      orderBy: { name: "asc" },
    }),
    resolveBriefAgentSlug(orgId),
  ]);
  ok(res, {
    agentSlug: effective,
    configured: org?.dailyBriefAgentSlug ?? null,
    default: CONFIG.dailyBriefAgentSlug,
    available: agents,
  });
}));

/**
 * PUT /settings — set (or clear, with null) which agent runs this org's brief.
 * ORG-ADMIN only. A non-null slug must be an existing enabled agent in the org.
 */
router.put("/settings", asyncHandler(async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!userId || !orgId) throw unauthorized();
  const admin = (await isClawAdmin(userId)) || (await isOrgAdmin(userId, orgId));
  if (!admin) throw forbidden("Only an org admin can change the daily brief agent");
  const body = req.body as { agentSlug?: unknown };
  if (body.agentSlug !== undefined && body.agentSlug !== null && typeof body.agentSlug !== "string") {
    throw badRequest("agentSlug must be a string or null");
  }
  const slug = typeof body.agentSlug === "string" ? body.agentSlug.trim() : "";

  if (slug) {
    const agent = await prisma.agent.findUnique({
      where: { orgId_slug: { orgId, slug } },
      select: { slug: true, enabled: true },
    });
    if (!agent) throw badRequest(`Agent '${slug}' not found in this org`);
    if (!agent.enabled) throw badRequest(`Agent '${slug}' is disabled`);
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { dailyBriefAgentSlug: slug || null },
  });
  log.info(`[daily-brief] org ${orgId} brief agent set to '${slug || "(default)"}' by ${userId}`);

  ok(res, {
    agentSlug: await resolveBriefAgentSlug(orgId),
    configured: slug || null,
    default: CONFIG.dailyBriefAgentSlug,
  });
}));

// Re-export so callers can render a stored brief's JSON if needed.
export { renderBriefMarkdown };
export { router as dailyBriefRouter };
