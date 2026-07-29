/**
 * Entity extraction API.
 *
 * Every handler either writes a row or enqueues a job — no extraction runs in
 * this process. `workspaceId` is always taken from the authenticated session
 * and never from the request, so one workspace can't touch another's entities.
 *
 * Mounted behind requireAuth + requireClawAdmin in main.ts: a run reads a whole
 * channel's history with no per-user ACL guard, so triggering one is an
 * operator action, not a user action.
 */

import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { createLogger, createTraceId } from "../logger.js";
import { enqueueEntityExtraction } from "../queue/entity-extraction-queue.js";
import { syncChannelTypes } from "../services/entityExtraction/channelTypeSync.js";
import { getClawUserId } from "../middleware/tenant-context.js";
import { getSpacesUserWorkspaceId, spacesDbAvailable } from "../lib/spaces-db.js";
import { getChannel } from "../services/entityExtraction/channelSource.js";

const logger = createLogger("entity-extraction-api", createTraceId());

const router = Router();

/** Proposed type as stored on the run, awaiting approval. */
interface ProposedType {
  name: string;
  prefix: string;
  rule: string;
  examples?: string[];
}

/**
 * Resolve the caller's workspace.
 *
 * NOT from `req.user` — despite what types/express.d.ts documents, nothing in
 * claw-auth ever assigns `req.user`; identity arrives as the `x-user-id` header
 * that requireAuth sets. Reading `req.user.workspaceId` (as the Spaces original
 * did) makes every request 401.
 *
 * Order: explicit `workspaceId` in the body/query wins, else the caller's
 * workspace from the Spaces DB. For channel-scoped routes prefer
 * `workspaceForChannel`, which derives it from the channel itself.
 */
async function workspaceOf(req: Request): Promise<string | null> {
  const body = (req.body ?? {}) as { workspaceId?: unknown };
  const explicit = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const fromQuery = typeof req.query["workspaceId"] === "string" ? req.query["workspaceId"].trim() : "";
  if (explicit) return explicit;
  if (fromQuery) return fromQuery;

  const userId = getClawUserId(req);
  if (!userId || !spacesDbAvailable()) return null;
  return getSpacesUserWorkspaceId(userId).catch(() => null);
}

/**
 * Workspace for a channel-scoped request. The channel's OWN workspace (read off
 * its Vespa document) is authoritative — a run belongs to the workspace that
 * owns the channel, not to whichever workspace the triggering session happens
 * to be scoped to. Falls back to the caller's, then to an explicit override.
 */
async function workspaceForChannel(req: Request, channelId: string): Promise<string | null> {
  const explicit = await workspaceOf(req);
  if (explicit) return explicit;
  const channel = await getChannel(channelId).catch(() => null);
  return channel?.workspaceId ?? null;
}

/**
 * A RUNNING run older than this with no completion recorded is treated as dead.
 * Must exceed the worker's 3h lock (a full channel is ~140 serial LLM calls) so
 * a genuinely long run is never mislabelled. Env-tunable.
 */
const RUN_STALE_MS = Number(process.env["ENTITY_RUN_STALE_MS"] ?? 4 * 60 * 60_000);

/**
 * Load a run by id, resolving a dead one on the way out.
 *
 * The DB row is the source of truth for run status; the frontend just fetches
 * it by runId. The one gap is a pod that crashes mid-discovery: the worker only
 * marks a run FAILED on BullMQ's `failed` event (after retries), so a crash
 * leaves the row RUNNING with nothing to ever close it. Rather than poll the
 * queue in the background, we resolve it here, at read time: a RUNNING row past
 * RUN_STALE_MS is flipped to FAILED and returned that way. Self-healing exactly
 * when someone looks, from the DB, keyed by runId.
 *
 * The transition is guarded on `status = 'RUNNING'`, so it is idempotent and
 * safe under concurrent reads.
 */
async function loadRun(runId: string) {
  const run = await prisma.entityExtractionRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "RUNNING") return run;

  if (Date.now() - run.startedAt.getTime() <= RUN_STALE_MS) return run;

  await prisma.entityExtractionRun.updateMany({
    where: { id: runId, status: "RUNNING" },
    data: {
      status: "FAILED",
      errorMessage: "Run did not complete (worker crashed or was lost mid-discovery).",
      completedAt: new Date(),
    },
  });
  return prisma.entityExtractionRun.findUnique({ where: { id: runId } });
}

const NO_WORKSPACE =
  "Could not resolve a workspace: pass `workspaceId` explicitly, or configure SPACES_DB_URL so it can be derived from x-user-id.";

/**
 * POST /channels/:channelId/runs
 * Start type discovery for a channel. Returns immediately; the run pauses at
 * type approval.
 */
router.post("/channels/:channelId/runs", async (req: Request, res: Response) => {
  const channelId = String(req.params["channelId"] ?? "");
  const workspaceId = await workspaceForChannel(req, channelId);
  if (!workspaceId) return res.status(400).json({ error: NO_WORKSPACE });

  // Optional free-text framing for this channel, appended to the LLM prompt so
  // discovery knows what the channel is about (e.g. "payment gateway incidents
  // across merchants"). Org-level framing is applied automatically from config.
  const { context } = (req.body ?? {}) as { context?: string };

  const inFlight = await prisma.entityExtractionRun.findFirst({
    where: {
      workspaceId,
      channelId,
      status: { in: ["RUNNING", "AWAITING_TYPE_APPROVAL"] },
    },
  });
  if (inFlight) {
    return res.status(409).json({
      error: "A run is already in progress for this channel",
      runId: inFlight.id,
      status: inFlight.status,
    });
  }

  const run = await prisma.entityExtractionRun.create({
    data: {
      workspaceId,
      channelId,
      status: "RUNNING",
      stage: "FETCHING_MESSAGES",
      settings: context && context.trim() ? { channelContext: context.trim() } : {},
      triggeredByUserId: getClawUserId(req) || null,
    },
  });

  await enqueueEntityExtraction({ runId: run.id, workspaceId, channelId });

  logger.info("[entity-extraction-api] run started", { runId: run.id, channelId });
  return res.status(202).json({ runId: run.id, status: run.status });
});

/** GET /runs/:runId — run status and progress. */
router.get("/runs/:runId", async (req: Request, res: Response) => {
  const run = await loadRun(String(req.params["runId"] ?? ""));
  if (!run) return res.status(404).json({ error: "Run not found" });
  return res.json(run);
});

/** GET /runs/:runId/types — types awaiting approval, plus what was dropped. */
router.get("/runs/:runId/types", async (req: Request, res: Response) => {
  const run = await loadRun(String(req.params["runId"] ?? ""));
  if (!run) return res.status(404).json({ error: "Run not found" });
  if (!run.proposedTypes) {
    return res.status(409).json({ error: "Types not proposed yet", status: run.status });
  }
  return res.json(run.proposedTypes);
});

/**
 * POST /runs/:runId/types — approve the types. In the current types-only scope
 * this finalizes the run; entity extraction against them is a later phase.
 *
 * Body accepts edits, because you will always want them:
 *   { approve: ["GATEWAY"], reject: ["API"],
 *     edit: { "SERVICE": { rule: "..." } },
 *     add:  [{ name, prefix, rule, examples }] }
 *
 * Anything not named in `approve` is skipped, so approving is explicit.
 */
router.post("/runs/:runId/types", async (req: Request, res: Response) => {
  const run = await loadRun(String(req.params["runId"] ?? ""));
  if (!run) return res.status(404).json({ error: "Run not found" });
  const workspaceId = run.workspaceId;
  if (!workspaceId) return res.status(400).json({ error: "Run has no workspace" });
  if (run.status !== "AWAITING_TYPE_APPROVAL") {
    return res.status(409).json({ error: `Run is ${run.status}, not awaiting approval` });
  }

  const {
    approve = [],
    edit = {},
    add = [],
  } = (req.body ?? {}) as {
    approve?: string[];
    reject?: string[];
    edit?: Record<string, Partial<ProposedType>>;
    add?: ProposedType[];
  };

  const proposed = (run.proposedTypes as { types?: ProposedType[] } | null)?.types ?? [];
  const chosen: ProposedType[] = [
    ...proposed
      .filter((t) => approve.includes(t.name))
      .map((t) => ({ ...t, ...(edit[t.name] ?? {}) })),
    ...add,
  ];

  if (chosen.length === 0) {
    return res.status(400).json({ error: "No types approved" });
  }

  const userId = getClawUserId(req) || null;

  // upsert, not create: a type already approved from another channel keeps its
  // original definition rather than being duplicated or overwritten.
  for (const type of chosen) {
    await prisma.entityTypeDefinition.upsert({
      where: { workspaceId_name: { workspaceId, name: type.name } },
      create: {
        workspaceId,
        name: type.name,
        prefix: type.prefix,
        rule: type.rule,
        examples: type.examples ?? [],
        status: "APPROVED",
        proposedInRunId: run.id,
        approvedByUserId: userId,
        approvedAt: new Date(),
      },
      update: {
        status: "APPROVED",
        approvedByUserId: userId,
        approvedAt: new Date(),
      },
    });
  }

  // Types-only scope for now: approving finalizes the run. Entity extraction
  // against these approved types is a later phase.
  await prisma.entityExtractionRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETED",
      stage: "DONE",
      completedAt: new Date(),
      approvedTypeNames: chosen.map((t) => t.name),
    },
  });

  // Mirror the channel's vocabulary onto its Vespa document so search can
  // filter by it. Runs AFTER the Postgres writes and never throws — Postgres is
  // the source of truth, so a Vespa failure must not fail an approval that has
  // already committed. It is reported so the caller knows to re-sync.
  const vespaSync = await syncChannelTypes(workspaceId, run.channelId);

  logger.info("[entity-extraction-api] types approved", {
    runId: run.id,
    approved: chosen.length,
    vespaSynced: vespaSync.ok,
  });
  return res.status(200).json({
    runId: run.id,
    approvedTypes: chosen.map((t) => t.name),
    channelEntityTypes: vespaSync.entityTypes,
    vespaSync: vespaSync.ok ? "ok" : "failed",
    ...(vespaSync.error ? { vespaSyncError: vespaSync.error } : {}),
  });
});

/**
 * POST /channels/:channelId/resync-types
 * Re-push the channel's approved type set to Vespa. Needed when a sync failed
 * at approval time, or when a full channel re-ingest cleared `entityTypes`.
 */
router.post("/channels/:channelId/resync-types", async (req: Request, res: Response) => {
  const channelId = String(req.params["channelId"] ?? "");
  const workspaceId = await workspaceForChannel(req, channelId);
  if (!workspaceId) return res.status(400).json({ error: NO_WORKSPACE });

  const result = await syncChannelTypes(workspaceId, channelId);
  return res.status(result.ok ? 200 : 502).json({
    channelId,
    entityTypes: result.entityTypes,
    vespaSync: result.ok ? "ok" : "failed",
    ...(result.error ? { error: result.error } : {}),
  });
});

export { router as entityExtractionRouter };
