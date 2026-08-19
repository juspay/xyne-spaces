/**
 * Internal (S2S) KB filesystem routes.
 *
 * xyne-claw runs the agent and its tools but holds no Spaces session — that
 * lives here, the same arrangement as memory/agent-file. Claw calls these with
 * `x-s2s-key`; this router does the collection work through KbFs.
 *
 * The data plane (list/read/grep/write/edit) is requireStrictS2S, NOT
 * requireAuth. `userId` and `collectionId` come off the request and KbFs opens
 * the collection as THAT user, so a cookie from any logged-in user would read
 * and write any collection its owner can see — and a KB page cannot be deleted
 * once written. The admin routes below are the browser half and keep
 * requireClawAdmin over the mount-level requireAuth.
 *
 * A KbFs is opened per request rather than cached: the index costs one HTTP
 * call, and a cached instance would silently go stale against edits made in the
 * Spaces UI.
 */

import { Router, type Request, type Response } from "express";
import { requireStrictS2S } from "../middleware/require-auth.js";
import { KbFs } from "../lib/kb-fs.js";
import { createLogger, createTraceId } from "../logger.js";
import { requireClawAdmin, getRequesterId } from "../middleware/agent-acl.js";
import { runKbExtraction } from "../services/kbExtractDaily.js";
import { runKbMerge, runKbMergePending } from "../services/kbMergeDaily.js";
import { runKbReconcile } from "../services/kbReconcile.js";
import { prisma } from "../db.js";

const logger = createLogger("kb-routes", createTraceId());
export const kbRouter: Router = Router();

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

/** A bad request from the caller. Distinguished from a downstream failure. */
class BadRequest extends Error {}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) throw new BadRequest(`${key} is required`);
  return trimmed;
}

function optionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Rejects any attempt to walk out of the collection. */
function requirePath(source: Record<string, unknown>): string {
  const path = requireString(source, "path");
  if (path.startsWith("/") || path.includes("..")) {
    throw new BadRequest("path must be relative with no '..' segments");
  }
  return path;
}

/** Opens the collection named by the request. */
async function openFs(source: Record<string, unknown>): Promise<KbFs> {
  const collectionId = requireString(source, "collectionId");
  const userId = requireString(source, "userId");
  const scopeType = optionalString(source, "scopeType");
  const scopeId = optionalString(source, "scopeId");

  return KbFs.open(collectionId, userId, {
    ...(scopeType ? { scopeType } : {}),
    ...(scopeId ? { scopeId } : {}),
  });
}

// ---------------------------------------------------------------------------
// Handler wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps a handler so every route shares one error contract:
 *
 *   BadRequest              → 400, the caller can fix it
 *   "not found"/"not unique" → 400, the AGENT can fix it by retrying differently
 *   anything else            → 502, something downstream broke
 *
 * Without this each route grew its own try/catch and they drifted.
 */
function handle<T>(
  name: string,
  fn: (source: Record<string, unknown>) => Promise<T>,
) {
  return async (req: Request, res: Response): Promise<void> => {
    const source = (req.method === "GET" ? req.query : req.body ?? {}) as Record<string, unknown>;
    try {
      res.json({ success: true, data: await fn(source) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const callerError = err instanceof BadRequest || /not found|not unique/.test(message);
      if (!callerError) logger.warn(`[kb] ${name} failed: ${message}`);
      res.status(callerError ? 400 : 502).json({ success: false, error: message });
    }
  };
}

/**
 * Wraps an admin handler so a rejected promise becomes a 500 rather than a hung
 * request. Express 4 does not catch async rejections — they surface as
 * `unhandledRejection`, which main.ts only logs — so without this a bad query
 * param (`?limit=abc` -> `take: NaN`) leaves the caller waiting on a response
 * that never comes.
 */
function adminHandle(
  name: string,
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[kb-admin] ${name} failed: ${message}`);
      if (!res.headersSent) res.status(500).json({ success: false, error: message });
    }
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** GET /kb/list?userId=&collectionId=&prefix= */
kbRouter.get(
  "/list",
  requireStrictS2S,
  handle("list", async (source) => {
    const fs = await openFs(source);
    return { paths: fs.list(optionalString(source, "prefix") ?? "") };
  }),
);

/** GET /kb/read?userId=&collectionId=&path= */
kbRouter.get(
  "/read",
  requireStrictS2S,
  handle("read", async (source) => {
    const path = requirePath(source);
    const fs = await openFs(source);
    const content = await fs.read(path);
    // A missing page is a normal answer, not an error: the agent probes for
    // existence constantly and shouldn't have to tell 404 from failure.
    return { path, found: content !== null, content };
  }),
);

/** GET /kb/grep?userId=&collectionId=&pattern=&prefix= */
kbRouter.get(
  "/grep",
  requireStrictS2S,
  handle("grep", async (source) => {
    const pattern = requireString(source, "pattern");
    const fs = await openFs(source);
    return { matches: await fs.grep(pattern, optionalString(source, "prefix") ?? "") };
  }),
);

/** POST /kb/write  { userId, collectionId, path, content } */
kbRouter.post(
  "/write",
  requireStrictS2S,
  handle("write", async (source) => {
    const path = requirePath(source);
    const content = requireString(source, "content");
    const fs = await openFs(source);
    const outcome = await fs.write(path, content);
    logger.info(`[kb] ${outcome.status} ${path}`);
    return outcome;
  }),
);

/** POST /kb/edit  { userId, collectionId, path, oldText, newText } */
kbRouter.post(
  "/edit",
  requireStrictS2S,
  handle("edit", async (source) => {
    const path = requirePath(source);
    const oldText = requireString(source, "oldText");
    // Empty newText is legitimate — it deletes the snippet.
    const newText = typeof source["newText"] === "string" ? source["newText"] : "";
    const fs = await openFs(source);
    const outcome = await fs.edit(path, oldText, newText);
    logger.info(`[kb] edited ${path}`);
    return outcome;
  }),
);

/**
 * Admin trigger: build the KB for one project now, instead of waiting for the
 * nightly. Admin-only, because it starts a run that costs real model spend and
 * writes into a shared knowledge base.
 *
 * Returns immediately — extraction takes minutes per project, far longer than a
 * request should hold. Each channel resumes from its own watermark, so this
 * catches up whatever is outstanding rather than covering a caller-chosen day.
 * Progress is visible in kb_runs (kind=EXTRACT); findings land in GCS.
 */
kbRouter.post(
  "/extract/:projectCode",
  requireClawAdmin,
  adminHandle("POST /extract/:projectCode", async (req: Request, res: Response) => {
    const projectCode = String(req.params["projectCode"] ?? "").toUpperCase();
    if (!projectCode) {
      res.status(400).json({ success: false, error: "projectCode required" });
      return;
    }

    // A run is asynchronous and takes minutes. Without this, a second click walks
    // from the same watermark and re-extracts the same windows — duplicated model
    // spend for findings the merge will only dedupe away.
    const active = await prisma.kbRun.findFirst({
      where: {
        kind: "EXTRACT",
        projectCode,
        status: "RUNNING",
        // Anything older than an hour is an orphan from a killed process, not a
        // live run — no single window takes that long.
        startedAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
      orderBy: { startedAt: "desc" },
    });

    if (active) {
      const window = active.windowFrom?.toISOString().slice(0, 10) ?? "?";
      res.status(409).json({
        success: false,
        error: `extraction already running for ${projectCode} (${active.subject}, window ${window}) — wait for it to finish`,
      });
      return;
    }

    void runKbExtraction(projectCode).catch((err) => {
      logger.error(
        `[kb-extract] on-demand run failed for ${projectCode}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    res.status(202).json({ success: true, data: { projectCode, status: "started" } });
  }),
);

// ---------------------------------------------------------------------------
// Admin: which projects and channels feed the KB
// ---------------------------------------------------------------------------

/** Everything the admin screen renders: opted-in projects and per-channel progress. */
kbRouter.get(
  "/projects",
  requireClawAdmin,
  adminHandle("GET /projects", async (_req: Request, res: Response) => {
    const projects = await prisma.kbProject.findMany({
      include: { channels: { orderBy: { name: "asc" } } },
      orderBy: { projectCode: "asc" },
    });

    res.json({
      success: true,
      data: projects.map((project) => ({
        projectId: project.projectId,
        projectCode: project.projectCode,
        projectName: project.projectName,
        collectionId: project.collectionId,
        extractAgentSlug: project.extractAgentSlug,
        mergeAgentSlug: project.mergeAgentSlug,
        reconcileAgentSlug: project.reconcileAgentSlug,
        enabled: project.enabled,
        enabledBy: project.enabledBy,
        enabledAt: project.enabledAt,
        channels: project.channels.map((channel) => ({
          channelId: channel.channelId,
          name: channel.name,
          visibility: channel.visibility,
          included: channel.included,
          includedBy: channel.includedBy,
          // Progress is the pair: where the walk starts, and how far it has got.
          // `extractedThrough` alone cannot distinguish "nearly done" from
          // "barely started" without knowing the origin.
          backfillFrom: channel.backfillFrom,
          includedAt: channel.includedAt,
          extractedThrough: channel.extractedThrough,
          lastRunAt: channel.lastRunAt,
          lastError: channel.lastError,
        })),
      })),
    });
  }),
);

/**
 * Opt a project in, or change where its KB is written.
 *
 * Upsert rather than create: re-enabling a project that was turned off should
 * keep its channels and their watermarks, so it resumes instead of re-extracting
 * everything.
 */
kbRouter.post(
  "/projects",
  requireClawAdmin,
  adminHandle("POST /projects", async (req: Request, res: Response) => {
    const body = req.body as {
      projectId?: string;
      projectCode?: string;
      projectName?: string;
      workspaceId?: string;
      collectionId?: string;
      enabled?: boolean;
      extractAgentSlug?: string;
      mergeAgentSlug?: string;
      reconcileAgentSlug?: string;
    };

    if (!body.projectId || !body.projectCode || !body.workspaceId || !body.collectionId) {
      res.status(400).json({
        success: false,
        error: "projectId, projectCode, workspaceId and collectionId are required",
      });
      return;
    }

    const enabled = body.enabled !== false;
    const actor = getRequesterId(req);
    const agentSlugs = {
      extractAgentSlug: body.extractAgentSlug?.trim() || null,
      mergeAgentSlug: body.mergeAgentSlug?.trim() || null,
      reconcileAgentSlug: body.reconcileAgentSlug?.trim() || null,
    };

    // The consent trail is written when a project is turned ON and left alone
    // otherwise. Nulling it on pause loses who accepted the extraction — and
    // `enabledBy` is also the identity the whole pipeline reads the KB as, so
    // a pause/resume under a different admin would silently re-point it and
    // knownEntities would quietly degrade to [] under an expired session.
    const consent = enabled ? { enabledBy: actor ?? null, enabledAt: new Date() } : {};

    const previous = await prisma.kbProject.findUnique({ where: { projectId: body.projectId } });

    const project = await prisma.kbProject.upsert({
      where: { projectId: body.projectId },
      create: {
        projectId: body.projectId,
        // Uppercased because this becomes the KB path segment, and a page cannot
        // be moved once written — "XYNE" and "xyne" would be two permanent trees.
        projectCode: body.projectCode.toUpperCase(),
        projectName: body.projectName ?? body.projectCode,
        workspaceId: body.workspaceId,
        collectionId: body.collectionId,
        enabled,
        ...agentSlugs,
        enabledBy: enabled ? actor ?? null : null,
        enabledAt: enabled ? new Date() : null,
      },
      update: {
        collectionId: body.collectionId,
        ...agentSlugs,
        enabled,
        ...consent,
      },
    });

    // enabledBy is not just an audit column — it is the identity every stage
    // reads and writes the KB as. Re-enabling under a different admin re-points
    // it, so say so rather than letting the pipeline change hands quietly.
    if (enabled && previous?.enabledBy && previous.enabledBy !== project.enabledBy) {
      logger.warn(
        `[kb-admin] project ${project.projectCode} KB identity moved from ${previous.enabledBy} to ${project.enabledBy ?? "?"}`,
      );
    }
    logger.info(`[kb-admin] project ${project.projectCode} enabled=${enabled} by=${actor ?? "?"}`);
    res.json({ success: true, data: project });
  }),
);

/**
 * Include or exclude one channel.
 *
 * Private channels are excluded by default and are opted in HERE, deliberately:
 * nothing in the stack can delete a KB page, so a wrongly-included private
 * channel cannot be retracted. `includedBy` records who accepted that.
 *
 * `backfillFrom` sets how far back to walk. Omit it and extraction starts from
 * the moment of inclusion — the safe default, since backfilling a year of a
 * channel costs real money.
 */

/**
 * Oldest backfill we allow, in days.
 *
 * Enforced server-side rather than trusted to the caller: a typo'd year turns
 * into thousands of windows, each an agent session with real cost, and the
 * watermark means it would grind on across nights before anyone noticed.
 */
const MAX_BACKFILL_DAYS = 120;

/** The pipeline's stages, and therefore the only values `?kind=` may narrow to. */
const RUN_KINDS = new Set(["EXTRACT", "MERGE", "RECONCILE"]);

function clampBackfill(from: Date): { at: Date; clamped: boolean } {
  const floor = new Date(Date.now() - MAX_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  return from < floor ? { at: floor, clamped: true } : { at: from, clamped: false };
}

kbRouter.post(
  "/channels",
  requireClawAdmin,
  adminHandle("POST /channels", async (req: Request, res: Response) => {
    const body = req.body as {
      channelId?: string;
      projectId?: string;
      name?: string;
      visibility?: string;
      scopeType?: string;
      included?: boolean;
      backfillFrom?: string;
    };

    if (!body.channelId || !body.projectId) {
      res.status(400).json({ success: false, error: "channelId and projectId are required" });
      return;
    }

    const project = await prisma.kbProject.findUnique({ where: { projectId: body.projectId } });
    if (!project) {
      res.status(400).json({ success: false, error: "project is not opted in — enable it first" });
      return;
    }

    const included = body.included !== false;
    const actor = getRequesterId(req);
    // An unparseable date becomes an Invalid Date, whose every comparison is
    // false — so it slipped past clampBackfill and reached Prisma, which rejects
    // it. /backfill already validates this way; this endpoint did not.
    if (body.backfillFrom !== undefined && Number.isNaN(Date.parse(String(body.backfillFrom)))) {
      res.status(400).json({ success: false, error: "backfillFrom must be an ISO date" });
      return;
    }
    const requested = body.backfillFrom ? new Date(body.backfillFrom) : undefined;
    const clamp = requested ? clampBackfill(requested) : undefined;
    const backfillFrom = clamp?.at;
    if (clamp?.clamped) {
      logger.warn(`[kb-admin] backfill for ${body.channelId} clamped to ${MAX_BACKFILL_DAYS} days`);
    }

    const channel = await prisma.kbChannel.upsert({
      where: { channelId: body.channelId },
      create: {
        channelId: body.channelId,
        projectId: body.projectId,
        name: body.name ?? body.channelId,
        visibility: body.visibility ?? "PUBLIC",
        scopeType: body.scopeType ?? "DEFAULT",
        included,
        includedBy: included ? actor ?? null : null,
        includedAt: included ? new Date() : null,
        backfillFrom: backfillFrom ?? null,
      },
      update: {
        included,
        includedBy: included ? actor ?? null : null,
        includedAt: included ? new Date() : null,
        ...(backfillFrom ? { backfillFrom } : {}),
      },
    });

    logger.info(
      `[kb-admin] channel ${channel.name} (${channel.visibility}) included=${included} by=${actor ?? "?"}`,
    );
    res.json({ success: true, data: channel });
  }),
);

/**
 * Extract one channel now.
 *
 * Project-wide extraction walks every included channel, which is the wrong
 * granularity when only one is behind or you are testing a prompt change on a
 * single channel.
 */
kbRouter.post(
  "/channels/:channelId/extract",
  requireClawAdmin,
  adminHandle("POST /channels/:channelId/extract", async (req: Request, res: Response) => {
    const channelId = String(req.params["channelId"] ?? "");
    const channel = await prisma.kbChannel.findUnique({
      where: { channelId },
      include: { project: true },
    });
    if (!channel) {
      res.status(404).json({ success: false, error: "channel not registered" });
      return;
    }

    const active = await prisma.kbRun.findFirst({
      where: {
        kind: "EXTRACT",
        channelId,
        status: "RUNNING",
        startedAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (active) {
      res.status(409).json({
        success: false,
        error: `extraction already running for ${channel.name} (window ${active.windowFrom?.toISOString().slice(0, 10) ?? "?"})`,
      });
      return;
    }

    void runKbExtraction(channel.project.projectCode, channelId).catch((err) => {
      logger.error(
        `[kb-extract] on-demand channel run failed for ${channel.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    res.status(202).json({ success: true, data: { channel: channel.name, status: "started" } });
  }),
);

/**
 * Recent runs across every stage of the pipeline.
 *
 * One endpoint rather than three, because the question is almost always "what
 * happened to this project?" — and extract, merge and reconcile are stages of
 * one chain. Narrow with ?kind= when you want a single stage.
 */
kbRouter.get(
  "/runs",
  requireClawAdmin,
  adminHandle("GET /runs", async (req: Request, res: Response) => {
    // `?limit=abc` is NaN, which Prisma rejects at query time — a 500 at best and
    // a hung request without adminHandle. Anything unparseable falls back to the
    // default rather than failing the panel's diagnostic panel.
    const requestedLimit = Number(req.query["limit"]);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 400)
      : 120;
    const requestedKind = String(req.query["kind"] ?? "").toUpperCase();
    const kind = RUN_KINDS.has(requestedKind) ? requestedKind : "";
    const runs = await prisma.kbRun.findMany({
      where: kind ? { kind } : {},
      orderBy: { startedAt: "desc" },
      take: limit,
    });
    res.json({ success: true, data: runs });
  }),
);

/**
 * Stop extracting a project and forget its progress.
 *
 * Cascades to its channels and their run history. This does NOT delete the KB
 * pages already written — nothing in the stack can. Removing a project stops
 * new findings; the pages it produced stay in the collection.
 *
 * To pause instead, set enabled=false: that keeps the watermarks, so resuming
 * picks up where it left off rather than re-extracting (and re-paying for)
 * everything.
 */
kbRouter.delete(
  "/projects/:projectId",
  requireClawAdmin,
  adminHandle("DELETE /projects/:projectId", async (req: Request, res: Response) => {
    const projectId = String(req.params["projectId"] ?? "");
    const existing = await prisma.kbProject.findUnique({ where: { projectId } });
    if (!existing) {
      res.status(404).json({ success: false, error: "project not registered" });
      return;
    }

    await prisma.kbProject.delete({ where: { projectId } });
    logger.info(`[kb-admin] project ${existing.projectCode} removed by ${getRequesterId(req) ?? "?"}`);
    res.json({ success: true, data: { projectCode: existing.projectCode } });
  }),
);

/**
 * Remove a channel from extraction, discarding its watermark and run history.
 *
 * Un-ticking `included` is usually what you want: it stops extraction but keeps
 * `extractedThrough`, so re-including resumes instead of re-reading months of
 * history through the model again.
 */
kbRouter.delete(
  "/channels/:channelId",
  requireClawAdmin,
  adminHandle("DELETE /channels/:channelId", async (req: Request, res: Response) => {
    const channelId = String(req.params["channelId"] ?? "");
    const existing = await prisma.kbChannel.findUnique({ where: { channelId } });
    if (!existing) {
      res.status(404).json({ success: false, error: "channel not registered" });
      return;
    }

    await prisma.kbChannel.delete({ where: { channelId } });
    logger.info(`[kb-admin] channel ${existing.name} removed by ${getRequesterId(req) ?? "?"}`);
    res.json({ success: true, data: { name: existing.name } });
  }),
);

/**
 * Re-run extraction for a channel from a given date.
 *
 * Clears the watermark so the next run walks forward from `from` again. Setting
 * `backfillFrom` alone does nothing: pendingWindows() reads
 * `extractedThrough ?? backfillFrom`, so the watermark always wins until it is
 * cleared — which is the whole point of this endpoint.
 *
 * Re-extracted findings are safe to merge: they carry the same idempotencyKey,
 * so the merge treats them as confirmation rather than duplicates. The cost is
 * model spend on ground already covered, so this is an explicit action rather
 * than something a date change triggers silently.
 */
kbRouter.post(
  "/channels/:channelId/backfill",
  requireClawAdmin,
  adminHandle("POST /channels/:channelId/backfill", async (req: Request, res: Response) => {
    const channelId = String(req.params["channelId"] ?? "");
    const from = (req.body as { from?: string })?.from;
    if (!from || Number.isNaN(Date.parse(from))) {
      res.status(400).json({ success: false, error: "from (ISO date) is required" });
      return;
    }

    const existing = await prisma.kbChannel.findUnique({ where: { channelId } });
    if (!existing) {
      res.status(404).json({ success: false, error: "channel not registered" });
      return;
    }

    const { at: clampedFrom, clamped } = clampBackfill(new Date(from));
    const channel = await prisma.kbChannel.update({
      where: { channelId },
      data: {
        backfillFrom: clampedFrom,
        extractedThrough: null,
        lastError: null,
      },
    });

    logger.info(
      `[kb-admin] backfill queued for ${channel.name} from ${from} by ${getRequesterId(req) ?? "?"}`,
    );
    res.json({
      success: true,
      data: { name: channel.name, backfillFrom: channel.backfillFrom, clamped },
    });
  }),
);

/**
 * Admin trigger: merge a day's findings into KB pages now.
 *
 * Defaults to yesterday, the partition the nightly would have consumed.
 * Returns immediately — a merge takes minutes per project. Progress lands in
 * kb_runs, which the admin screen renders.
 */
kbRouter.post(
  "/merge/:projectCode",
  requireClawAdmin,
  adminHandle("POST /merge/:projectCode", async (req: Request, res: Response) => {
    const projectCode = String(req.params["projectCode"] ?? "").toUpperCase();
    // A specific day when asked for; otherwise everything outstanding, oldest
    // first — a backfill produces many days of findings and merging only one
    // would leave the rest stranded in storage.
    const dayParam = req.query["day"];
    const day =
      typeof dayParam === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : null;

    const activeMerge = await prisma.kbRun.findFirst({
      where: {
        kind: "MERGE",
        projectCode,
        status: "RUNNING",
        startedAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
      orderBy: { startedAt: "desc" },
    });

    if (activeMerge) {
      res.status(409).json({
        success: false,
        error: `merge already running for ${projectCode} (day ${activeMerge.subject}) — wait for it to finish`,
      });
      return;
    }

    const work = day ? runKbMerge(day, projectCode) : runKbMergePending(projectCode);
    void work.catch((err) => {
      logger.error(
        `[kb-merge] on-demand run failed for ${projectCode}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    res.status(202).json({
      success: true,
      data: { projectCode, day: day ?? "all pending", status: "started" },
    });
  }),
);

/**
 * Re-read the written KB and correct it.
 *
 * Manual only, and deliberately so: this rewrites pages the merge already wrote,
 * and a fold cannot be undone.
 */
kbRouter.post(
  "/reconcile/:projectCode",
  requireClawAdmin,
  adminHandle("POST /reconcile/:projectCode", async (req: Request, res: Response) => {
    const projectCode = String(req.params["projectCode"] ?? "").toUpperCase();
    if (!projectCode) {
      res.status(400).json({ success: false, error: "projectCode required" });
      return;
    }

    // Two reconciles at once would each rewrite pages from a view of the KB the
    // other is already changing — the later write silently wins.
    const active = await prisma.kbRun.findFirst({
      where: {
        kind: "RECONCILE",
        projectCode,
        status: "RUNNING",
        startedAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
      orderBy: { startedAt: "desc" },
    });

    if (active) {
      res.status(409).json({
        success: false,
        error: `reconcile already running for ${projectCode} (${active.subject}) — wait for it to finish`,
      });
      return;
    }

    // ?entity=services/vespa narrows to one, for a targeted fix rather than a sweep.
    const entity = typeof req.query["entity"] === "string" ? req.query["entity"].trim() : "";
    void runKbReconcile(projectCode, entity || undefined).catch((err) => {
      logger.error(
        `[kb-reconcile] on-demand run failed for ${projectCode}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    res.status(202).json({ success: true, data: { projectCode, status: "started" } });
  }),
);

