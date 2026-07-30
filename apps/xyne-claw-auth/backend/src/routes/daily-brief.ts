import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { getRequesterId, getOrgId, isClawAdmin, isOrgAdmin } from "../middleware/agent-acl.js";
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

const log = createLogger("daily-brief-routes");
const MAX_INSTRUCTIONS = 8000;

const router = Router();

/** GET /config — the user's Daily Brief enable flag + custom instructions. */
router.get("/config", async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    const orgId = getOrgId(req);
    if (!userId || !orgId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const [user, instruction] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { dailyBriefEnabled: true } }),
      userAgentInstructionRepository.findByUserAndAgent(userId, orgId, DAILY_BRIEF_SLUG),
    ]);
    res.json({
      success: true,
      data: {
        enabled: user?.dailyBriefEnabled ?? false,
        instructions: instruction?.enabled ? (instruction?.instructions ?? "") : "",
        updatedAt: instruction?.updatedAt ?? null,
      },
    });
  } catch (err) {
    log.error("[daily-brief] get config", err);
    res.status(500).json({ success: false, error: "Failed to load daily brief config" });
  }
});

/** PUT /config — toggle the brief on/off and/or set custom instructions. */
router.put("/config", async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    const orgId = getOrgId(req);
    if (!userId || !orgId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const body = req.body as { enabled?: unknown; instructions?: unknown };

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        res.status(400).json({ success: false, error: "enabled must be a boolean" });
        return;
      }
      await prisma.user.update({
        where: { id: userId },
        data: {
          dailyBriefEnabled: body.enabled,
          ...(body.enabled ? { dailyBriefEnabledAt: new Date() } : {}),
        },
      });
    }

    if (body.instructions !== undefined) {
      if (body.instructions !== null && typeof body.instructions !== "string") {
        res.status(400).json({ success: false, error: "instructions must be a string or null" });
        return;
      }
      const instructions = typeof body.instructions === "string" ? body.instructions.slice(0, MAX_INSTRUCTIONS) : "";
      await userAgentInstructionRepository.upsert(userId, orgId, DAILY_BRIEF_SLUG, {
        instructions,
        enabled: true,
      });
    }

    const [user, instruction] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { dailyBriefEnabled: true } }),
      userAgentInstructionRepository.findByUserAndAgent(userId, orgId, DAILY_BRIEF_SLUG),
    ]);
    res.json({
      success: true,
      data: {
        enabled: user?.dailyBriefEnabled ?? false,
        instructions: instruction?.instructions ?? "",
        updatedAt: instruction?.updatedAt ?? null,
      },
    });
  } catch (err) {
    log.error("[daily-brief] put config", err);
    res.status(500).json({ success: false, error: "Failed to save daily brief config" });
  }
});

/** GET /latest — today's stored brief (falls back to the most recent one). */
router.get("/latest", async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const today = briefDateBucket();
    const todays = await generatedContentRepository.findForBucket(userId, DAILY_BRIEF_KIND, today);
    const row = todays ?? (await generatedContentRepository.findLatest(userId, DAILY_BRIEF_KIND));
    if (!row) {
      res.json({ success: true, data: { status: "none" } });
      return;
    }
    res.json({
      success: true,
      data: {
        status: row.status,
        date: row.dateBucket,
        content: row.content,
        data: row.data,
        generatedAt: row.generatedAt,
        isToday: row.dateBucket === today,
      },
    });
  } catch (err) {
    log.error("[daily-brief] get latest", err);
    res.status(500).json({ success: false, error: "Failed to load daily brief" });
  }
});

/** GET /history — the user's recent briefs, newest first (for the history list). */
router.get("/history", async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 30;
    const rows = await generatedContentRepository.findHistory(userId, DAILY_BRIEF_KIND, limit);
    res.json({
      success: true,
      data: rows.map((row) => ({
        date: row.dateBucket,
        status: row.status,
        content: row.content,
        data: row.data,
        agentSlug: row.agentSlug,
        generatedAt: row.generatedAt,
      })),
    });
  } catch (err) {
    log.error("[daily-brief] get history", err);
    res.status(500).json({ success: false, error: "Failed to load daily brief history" });
  }
});

/**
 * POST /regenerate — (SSE) re-run the brief now, streaming progress, and overwrite
 * today's stored brief. Emits: `start`, `progress` (label), `complete` (brief +
 * markdown), or `error`.
 */
router.post("/regenerate", async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
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

  send("start", { date: briefDateBucket() });
  try {
    const result = await generateDailyBrief(userId, {
      signal: abort.signal,
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
router.get("/settings", async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    const orgId = getOrgId(req);
    if (!userId || !orgId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const [org, agents, effective] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId }, select: { dailyBriefAgentSlug: true } }),
      prisma.agent.findMany({
        where: { orgId, enabled: true },
        select: { slug: true, name: true },
        orderBy: { name: "asc" },
      }),
      resolveBriefAgentSlug(orgId),
    ]);
    res.json({
      success: true,
      data: {
        agentSlug: effective,
        configured: org?.dailyBriefAgentSlug ?? null,
        default: CONFIG.dailyBriefAgentSlug,
        available: agents,
      },
    });
  } catch (err) {
    log.error("[daily-brief] get settings", err);
    res.status(500).json({ success: false, error: "Failed to load daily brief settings" });
  }
});

/**
 * PUT /settings — set (or clear, with null) which agent runs this org's brief.
 * ORG-ADMIN only. A non-null slug must be an existing enabled agent in the org.
 */
router.put("/settings", async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    const orgId = getOrgId(req);
    if (!userId || !orgId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const admin = (await isClawAdmin(userId)) || (await isOrgAdmin(userId, orgId));
    if (!admin) {
      res.status(403).json({ success: false, error: "Only an org admin can change the daily brief agent" });
      return;
    }
    const body = req.body as { agentSlug?: unknown };
    if (body.agentSlug !== undefined && body.agentSlug !== null && typeof body.agentSlug !== "string") {
      res.status(400).json({ success: false, error: "agentSlug must be a string or null" });
      return;
    }
    const slug = typeof body.agentSlug === "string" ? body.agentSlug.trim() : "";

    if (slug) {
      const agent = await prisma.agent.findUnique({
        where: { orgId_slug: { orgId, slug } },
        select: { slug: true, enabled: true },
      });
      if (!agent) {
        res.status(400).json({ success: false, error: `Agent '${slug}' not found in this org` });
        return;
      }
      if (!agent.enabled) {
        res.status(400).json({ success: false, error: `Agent '${slug}' is disabled` });
        return;
      }
    }

    await prisma.organization.update({
      where: { id: orgId },
      data: { dailyBriefAgentSlug: slug || null },
    });
    log.info(`[daily-brief] org ${orgId} brief agent set to '${slug || "(default)"}' by ${userId}`);

    res.json({
      success: true,
      data: {
        agentSlug: await resolveBriefAgentSlug(orgId),
        configured: slug || null,
        default: CONFIG.dailyBriefAgentSlug,
      },
    });
  } catch (err) {
    log.error("[daily-brief] put settings", err);
    res.status(500).json({ success: false, error: "Failed to save daily brief settings" });
  }
});

// Re-export so callers can render a stored brief's JSON if needed.
export { renderBriefMarkdown };
export { router as dailyBriefRouter };
