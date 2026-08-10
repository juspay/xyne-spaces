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
import {
  enqueueEntityExtraction,
  getEntityExtractionQueue,
} from "../queue/entity-extraction-queue.js";
import { syncChannelTypes } from "../services/entityExtraction/channelTypeSync.js";
import { getClawUserId } from "../middleware/tenant-context.js";
import { getSpacesUserWorkspaceId, spacesDbAvailable } from "../lib/spaces-db.js";
import { getChannel } from "../services/entityExtraction/channelSource.js";
/**
 * Naming rules for a type, applied to anything a human types in by hand.
 *
 * A name goes verbatim into extraction prompts and is the key search filters
 * are written against; a prefix becomes the entity id prefix. Both are
 * effectively permanent once approved, so neither may be persisted raw.
 *
 * `proposeTypes.ts` applies equivalent rules to model-proposed types. Keeping
 * these here rather than sharing a module is a deliberate trade: the two paths
 * are small, and this route is the only one accepting hand-entered types.
 */
function normalizeTypeName(raw: string): string {
  return (raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Lowercase alphanumerics, max 4 chars. Falls back to "ent" — an empty prefix
 *  makes unreadable entity ids, and uniqueness is handled by allocatePrefix. */
function normalizePrefix(raw: string): string {
  return (raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4) || "ent";
}

/**
 * A prefix not already in `taken`. `taken` must include prefixes already
 * persisted for the workspace: a prefix is an id prefix, so colliding across
 * two runs is exactly as bad as colliding within one.
 */
function allocatePrefix(desired: string, taken: ReadonlySet<string>): string {
  const base = normalizePrefix(desired);
  if (!taken.has(base)) return base;

  // Shorten to 3 so the numeric suffix keeps the prefix at 4 characters.
  const stem = base.slice(0, 3);
  for (let n = 2; n < 100; n++) {
    const candidate = `${stem}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}${Date.now().toString(36).slice(-2)}`;
}

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

/**
 * GET /runs — the workspace's runs, newest first.
 *
 * Without this the UI can only display a run it started in the current browser
 * session: reload the page and an in-flight discovery becomes invisible, and a
 * run someone else triggered is invisible from the start — while still blocking
 * its channel with a 409. This is what makes the state observable.
 *
 * `status` takes a comma-separated list, so "what is waiting for approval"
 * across every channel is a single request.
 *
 * Stale RUNNING rows are resolved in bulk on the way out, mirroring loadRun's
 * read-time self-heal — otherwise a crashed worker leaves rows that read as
 * in-flight forever and the list disagrees with the detail view.
 */
router.get("/runs", async (req: Request, res: Response) => {
  const workspaceId = await workspaceOf(req);
  if (!workspaceId) return res.status(400).json({ error: NO_WORKSPACE });

  const statusParam = typeof req.query["status"] === "string" ? req.query["status"] : "";
  const statuses = statusParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const channelId =
    typeof req.query["channelId"] === "string" ? req.query["channelId"].trim() : "";
  const limit = Math.min(Math.max(Number(req.query["limit"] ?? 50) || 50, 1), 200);

  await prisma.entityExtractionRun.updateMany({
    where: {
      workspaceId,
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - RUN_STALE_MS) },
    },
    data: {
      status: "FAILED",
      errorMessage: "Run did not complete (worker crashed or was lost mid-discovery).",
      completedAt: new Date(),
    },
  });

  const runs = await prisma.entityExtractionRun.findMany({
    where: {
      workspaceId,
      ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
      ...(channelId ? { channelId } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: limit,
  });

  // proposedTypes is dropped from the response and reduced to a count: the full
  // blob carries every candidate plus every drop reason, which is large and of
  // no use in a list. GET /runs/:runId/types serves the detail.
  return res.json({
    runs: runs.map((run) => {
      const proposed = (run.proposedTypes as { types?: unknown[] } | null)?.types;
      return {
        id: run.id,
        channelId: run.channelId,
        status: run.status,
        stage: run.stage,
        messageCount: run.messageCount,
        documentCount: run.documentCount,
        proposedCount: Array.isArray(proposed) ? proposed.length : 0,
        approvedTypeNames: run.approvedTypeNames,
        triggeredByUserId: run.triggeredByUserId,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        errorMessage: run.errorMessage,
      };
    }),
  });
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

  // Hand-entered types are validated, not coerced. A type name is a permanent
  // search key and its rule is prompt text, so silently persisting "" or a
  // name that normalizes away leaves the workspace with a type nobody can use
  // and no indication of what went wrong.
  const problems: string[] = [];
  const normalizedAdds = add.map((entry, index) => {
    const label = (entry?.name ?? "").trim() || `entry ${index + 1}`;
    const name = normalizeTypeName(entry?.name ?? "");
    const rule = (entry?.rule ?? "").trim();
    if (!name) problems.push(`"${label}": name must contain at least one letter or digit`);
    if (!rule) problems.push(`"${label}": rule is required — it goes verbatim into the extraction prompt`);
    return {
      name,
      // Prefix is optional on input: derive it from the name rather than
      // rejecting, since a blank prefix is a slip, not an ambiguity.
      prefix: (entry?.prefix ?? "").trim() || name.slice(0, 4),
      rule,
      examples: (entry?.examples ?? []).map((e) => String(e).trim()).filter(Boolean).slice(0, 5),
    };
  });

  const approvedProposed = proposed
    .filter((t) => approve.includes(t.name))
    .map((t) => ({ ...t, ...(edit[t.name] ?? {}) }));

  const chosen: ProposedType[] = [
    ...approvedProposed.map((t) => ({ ...t, name: normalizeTypeName(t.name) })),
    ...normalizedAdds,
  ];

  // Two entries normalizing to one name would make the upsert loop write the
  // same row twice, last-one-wins, with no hint that a choice was made.
  const seenNames = new Set<string>();
  for (const type of chosen) {
    if (!type.name) continue; // already reported above
    if (seenNames.has(type.name)) {
      problems.push(`"${type.name}" appears more than once — approved and added, or added twice`);
    }
    seenNames.add(type.name);
  }

  if (problems.length > 0) {
    return res.status(400).json({ error: "Some types could not be saved", problems });
  }

  if (chosen.length === 0) {
    return res.status(400).json({
      error:
        "No types approved. Select at least one proposed type, or add one — a run with an empty " +
        "type set cannot be completed and must be deleted instead.",
    });
  }

  const userId = getClawUserId(req) || null;

  // Existing definitions are loaded once, for two independent reasons: their
  // prefixes are already spoken for, and their names determine whether this
  // request creates a type or merely re-approves one that already exists.
  const existing = await prisma.entityTypeDefinition.findMany({
    where: { workspaceId },
    select: { name: true, prefix: true },
  });
  const existingNames = new Set(existing.map((t) => t.name));
  const takenPrefixes = new Set(existing.map((t) => normalizePrefix(t.prefix)));

  const created: string[] = [];
  /** Names that already existed — kept as-is, NOT redefined. See below. */
  const reused: string[] = [];

  // upsert, not create: a type already approved from another channel keeps its
  // original definition rather than being duplicated or overwritten. The rule
  // and prefix are deliberately absent from `update` — redefining a type that
  // other channels already filter by is a destructive act and needs its own
  // deliberate endpoint, not a side effect of approving a run. The response
  // reports which names took this path so the caller is never misled into
  // thinking an edited rule was applied.
  for (const type of chosen) {
    const isNew = !existingNames.has(type.name);
    const prefix = isNew ? allocatePrefix(type.prefix, takenPrefixes) : type.prefix;
    if (isNew) takenPrefixes.add(prefix);

    await prisma.entityTypeDefinition.upsert({
      where: { workspaceId_name: { workspaceId, name: type.name } },
      create: {
        workspaceId,
        name: type.name,
        prefix,
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

    (isNew ? created : reused).push(type.name);
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
    created: created.length,
    reused: reused.length,
    vespaSynced: vespaSync.ok,
  });
  return res.status(200).json({
    runId: run.id,
    approvedTypes: chosen.map((t) => t.name),
    // Split so the caller can say "GATEWAY already existed and kept its rule"
    // rather than implying every name in approvedTypes was written as sent.
    createdTypes: created,
    reusedTypes: reused,
    channelEntityTypes: vespaSync.entityTypes,
    vespaSync: vespaSync.ok ? "ok" : "failed",
    ...(vespaSync.error ? { vespaSyncError: vespaSync.error } : {}),
  });
});

/**
 * GET /jobs — what the discovery queue is actually doing.
 *
 * The run row says what a run believes about itself; this says what BullMQ
 * believes. They disagree exactly when something has gone wrong — a worker died
 * holding a job, a job is retrying against a run that already failed — and
 * without this the only way to see the queue was to exec into a pod.
 */
router.get("/jobs", async (req: Request, res: Response) => {
  const workspaceId = await workspaceOf(req);
  if (!workspaceId) return res.status(400).json({ error: NO_WORKSPACE });
  const allWorkspaces = String(req.query["allWorkspaces"] ?? "") === "true";

  const queue = getEntityExtractionQueue();
  // Counts are queue-wide and cannot be filtered — they describe the shared
  // queue, not this workspace, and are labelled as such in the response.
  const counts = await queue.getJobCounts();
  const jobs = await queue.getJobs(["active", "waiting", "delayed", "failed"], 0, 200);

  const mine = jobs
    .filter(Boolean)
    .filter((job) => allWorkspaces || job.data?.workspaceId === workspaceId);

  const rows = await Promise.all(
    mine.slice(0, 50).map(async (job) => ({
      jobId: job.id,
      state: await job.getState().catch(() => "unknown"),
      runId: job.data?.runId ?? null,
      channelId: job.data?.channelId ?? null,
      attemptsMade: job.attemptsMade,
      processedOn: job.processedOn ?? null,
      failedReason: job.failedReason ?? null,
    })),
  );

  return res.json({ queueCounts: counts, scope: allWorkspaces ? "all" : workspaceId, jobs: rows });
});

/**
 * Remove one job, doing whatever is actually possible for its state.
 *
 * Shared by the single-job and clear-queue routes so they cannot drift: the
 * active-job handling is subtle enough that two copies would eventually
 * disagree about what "deleted" means.
 */
async function removeQueueJob(
  job: Awaited<ReturnType<ReturnType<typeof getEntityExtractionQueue>["getJob"]>>,
  state: string,
): Promise<{ removed: boolean; discarded: boolean }> {
  if (!job) return { removed: false, discarded: false };

  let discarded = false;
  if (state === "active") {
    // Stops BullMQ retrying it once the current attempt ends or stalls. This is
    // the part that actually prevents the job coming back.
    try {
      await job.discard();
      discarded = true;
    } catch {
      // Non-fatal: removal is still attempted.
    }
  }

  let removed = false;
  await job
    .remove()
    .then(() => {
      removed = true;
    })
    .catch(() => {
      // Expected while a worker holds the lock; the discard above still applies.
    });

  return { removed, discarded };
}

/** Fail runs whose job just disappeared, so none is left claiming to be alive. */
async function failRunsForDeletedJobs(runIds: string[], why: string): Promise<number> {
  const ids = [...new Set(runIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const updated = await prisma.entityExtractionRun.updateMany({
    where: { id: { in: ids }, status: "RUNNING" },
    data: { status: "FAILED", errorMessage: why.slice(0, 1000), completedAt: new Date() },
  });
  return updated.count;
}

/**
 * DELETE /jobs — clear the discovery queue.
 *
 * Defaults to the safe thing: waiting and delayed jobs only, leaving anything
 * mid-execution alone. Active jobs need `force=true`, and even then the running
 * processor cannot be interrupted — see DELETE /jobs/:jobId.
 *
 * Jobs are enumerated and removed individually rather than via drain() or
 * obliterate(), for two reasons: those give back no list, so the runs they
 * orphan cannot be failed; and obliterate() takes the whole queue including
 * jobs that are perfectly healthy.
 *
 *   DELETE /jobs                             waiting + delayed
 *   DELETE /jobs?states=waiting,delayed,failed
 *   DELETE /jobs?states=active&force=true    discard in-flight work
 */
router.delete("/jobs", async (req: Request, res: Response) => {
  const workspaceId = await workspaceOf(req);
  if (!workspaceId) return res.status(400).json({ error: NO_WORKSPACE });
  // Scoped by default. The queue is shared across every workspace, so an
  // unscoped clear would destroy other tenants' pending runs — and "clear the
  // queue" is exactly the command someone runs while firefighting their own.
  const allWorkspaces = String(req.query["allWorkspaces"] ?? "") === "true";

  const force = String(req.query["force"] ?? "") === "true";
  const failRuns = String(req.query["failRuns"] ?? "true") !== "false";
  const limit = Math.min(Math.max(Number(req.query["limit"] ?? 200) || 200, 1), 1000);

  const requested = String(req.query["states"] ?? "waiting,delayed")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const ALLOWED = ["active", "waiting", "delayed", "failed", "completed"] as const;
  const invalid = requested.filter((s) => !ALLOWED.includes(s as (typeof ALLOWED)[number]));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Unknown job states: ${invalid.join(", ")}` });
  }
  if (requested.includes("active") && !force) {
    return res.status(409).json({
      error:
        "Refusing to clear active jobs without ?force=true. Their in-flight execution " +
        "cannot be interrupted; force only discards and removes them from the queue.",
    });
  }

  const jobs = await getEntityExtractionQueue().getJobs(
    requested as Parameters<ReturnType<typeof getEntityExtractionQueue>["getJobs"]>[0],
    0,
    limit,
  );

  const cleared: Array<{ jobId: string | undefined; state: string; runId: string | null; removed: boolean }> = [];
  const orphanedRunIds: string[] = [];

  for (const job of jobs) {
    if (!job) continue;
    if (!allWorkspaces && job.data?.workspaceId !== workspaceId) continue;
    const state = await job.getState().catch(() => "unknown");
    const { removed, discarded } = await removeQueueJob(job, state);
    if (job.data?.runId) orphanedRunIds.push(job.data.runId);
    cleared.push({ jobId: job.id, state, runId: job.data?.runId ?? null, removed: removed || discarded });
  }

  const runsFailed = failRuns
    ? await failRunsForDeletedJobs(orphanedRunIds, "Queue was cleared by an operator.")
    : 0;

  logger.info("[entity-extraction-api] queue cleared", {
    states: requested,
    jobs: cleared.length,
    runsFailed,
    forced: force,
  });

  return res.json({
    states: requested,
    jobsCleared: cleared.length,
    runsFailed,
    // Never a silent cap: if the queue was deeper than `limit`, say so.
    ...(jobs.length >= limit
      ? { warning: `Stopped at limit=${limit}; run again to clear the rest.` }
      : {}),
    jobs: cleared,
  });
});

/**
 * DELETE /jobs/:jobId — drop a job from the discovery queue.
 *
 * What this can and cannot do, because the difference matters:
 *
 * - waiting/delayed/failed/completed → removed outright.
 * - active → BullMQ holds a lock and offers no way to interrupt a running
 *   processor. There is no cancellation token threaded through discoverTypes,
 *   and adding one would mean checking for cancellation between every await in
 *   the pipeline. So `force=true` does the two things that ARE possible:
 *   discard the job so it is never retried, and attempt removal. The in-flight
 *   execution continues until it finishes or its pod restarts — the response
 *   says so via `stillRunning` rather than implying a kill.
 *
 * The run row is failed alongside by default. A job that will never complete
 * leaves the run RUNNING forever otherwise, and a RUNNING run blocks its
 * channel until the 4h stale sweep notices. Pass `failRun=false` to skip.
 */
router.delete("/jobs/:jobId", async (req: Request, res: Response) => {
  const jobId = String(req.params["jobId"] ?? "");
  const force = String(req.query["force"] ?? "") === "true";
  const failRun = String(req.query["failRun"] ?? "true") !== "false";

  const workspaceId = await workspaceOf(req);
  if (!workspaceId) return res.status(400).json({ error: NO_WORKSPACE });

  const job = await getEntityExtractionQueue().getJob(jobId);
  if (!job) return res.status(404).json({ error: `No job ${jobId} in the discovery queue` });

  // 404 rather than 403: whether another workspace has a job by this id is not
  // this caller's business to learn.
  if (job.data?.workspaceId && job.data.workspaceId !== workspaceId) {
    return res.status(404).json({ error: `No job ${jobId} in the discovery queue` });
  }

  const state = await job.getState().catch(() => "unknown");
  const runId: string | undefined = job.data?.runId;

  if (state === "active" && !force) {
    return res.status(409).json({
      error:
        "Job is active. Pass ?force=true to discard and remove it — note the in-flight " +
        "execution cannot be interrupted and continues until it finishes or its pod restarts.",
      jobId,
      state,
      runId: runId ?? null,
    });
  }

  const { removed, discarded } = await removeQueueJob(job, state);

  let runStatus: string | null = null;
  if (failRun && runId) {
    const count = await failRunsForDeletedJobs(
      [runId],
      `Job ${jobId} was deleted from the queue by an operator.`,
    );
    runStatus = count > 0 ? "FAILED" : "unchanged";
  }

  logger.info("[entity-extraction-api] job deleted", {
    jobId,
    state,
    runId,
    removed,
    discarded,
    runStatus,
  });

  return res.json({
    jobId,
    previousState: state,
    removed,
    discarded,
    // Honest about the limit: a discarded active job stops retrying, but the
    // worker keeps going until it returns or the pod restarts.
    stillRunning: state === "active",
    runId: runId ?? null,
    runStatus,
  });
});

/**
 * GET /types — the workspace's entity type vocabulary.
 *
 * Approving is the one irreversible step in this flow, so the UI needs to know
 * what already exists before it happens: an added type whose name collides with
 * an existing one is silently re-approved rather than redefined, and a
 * reviewer should see that coming rather than discover it afterwards.
 */
router.get("/types", async (req: Request, res: Response) => {
  const workspaceId = await workspaceOf(req);
  if (!workspaceId) return res.status(400).json({ error: NO_WORKSPACE });

  const status = typeof req.query["status"] === "string" ? req.query["status"].trim().toUpperCase() : "";

  const types = await prisma.entityTypeDefinition.findMany({
    where: { workspaceId, ...(status ? { status } : {}) },
    orderBy: { name: "asc" },
    select: {
      name: true,
      prefix: true,
      rule: true,
      examples: true,
      status: true,
      proposedInRunId: true,
      approvedAt: true,
    },
  });

  return res.json({ types });
});

/**
 * DELETE /runs/:runId
 * Delete a run outright, releasing its channel for a fresh trigger.
 *
 * This exists because a run can otherwise reach a state with no way out. If
 * discovery proposes zero types, the approve handler rejects it — `chosen` is
 * empty, so it 400s before the COMPLETED write — and nothing else assigns a
 * terminal status. Since POST /channels/:channelId/runs 409s on any RUNNING or
 * AWAITING_TYPE_APPROVAL run, one empty run blocks its channel permanently.
 * That is reachable whenever the LLM path is misconfigured, and it happened:
 * every typegen batch 403'd, each failure was swallowed into an empty label
 * list, and the run reported success with an empty taxonomy.
 *
 * Approved EntityTypeDefinition rows are deliberately NOT removed. They are
 * workspace-scoped and upserted, so the same type is shared across channels and
 * runs; deleting the run that first proposed one would silently strip a type
 * other channels depend on. `proposedInRunId` is left dangling on purpose — it
 * is provenance, not a foreign key.
 */
router.delete("/runs/:runId", async (req: Request, res: Response) => {
  const runId = String(req.params["runId"] ?? "");
  const run = await loadRun(runId);
  if (!run) return res.status(404).json({ error: "Run not found" });

  // A live worker holds this row: discoverTypes writes stage transitions as it
  // goes, and those updates throw once the row is gone. Deleting mid-discovery
  // is occasionally what you want (a wedged run), so allow it explicitly.
  const force = String(req.query["force"] ?? "") === "true";
  if (run.status === "RUNNING" && !force) {
    return res.status(409).json({
      error:
        "Run is RUNNING. Wait for it to finish, or pass ?force=true to delete it while the worker is mid-discovery.",
      runId,
      startedAt: run.startedAt,
    });
  }

  // Drop the queued job before the row. The job id is derived from the run id,
  // so a job left behind could wake on retry and find no run. Doing it in this
  // order means a failure below leaves a job whose run still exists (harmless)
  // rather than a job whose run does not.
  await getEntityExtractionQueue()
    .getJob(`entity-type-discovery_${runId}`)
    .then((job) => job?.remove())
    .catch(() => {});

  await prisma.entityExtractionRun.delete({ where: { id: runId } });

  logger.info("[entity-extraction-api] run deleted", {
    runId,
    channelId: run.channelId,
    status: run.status,
    forced: force,
  });
  return res.json({ runId, channelId: run.channelId, deleted: true, previousStatus: run.status });
});

/**
 * Re-push every channel that references `typeName` to Vespa.
 *
 * Deprecating is workspace-wide, but the projection search reads is per-channel,
 * so the type lingers as a filter value on every channel until each one is
 * re-synced. Doing that here makes deprecation take effect immediately instead
 * of whenever someone happens to approve another run.
 */
async function resyncChannelsReferencing(
  workspaceId: string,
  typeName: string,
): Promise<{ channels: string[]; failed: string[]; truncated: boolean }> {
  const RESYNC_LIMIT = 200;

  const runs = await prisma.entityExtractionRun.findMany({
    where: { workspaceId, approvedTypeNames: { has: typeName } },
    select: { channelId: true },
  });
  const all = [...new Set(runs.map((r) => r.channelId))];
  const channels = all.slice(0, RESYNC_LIMIT);

  const failed: string[] = [];
  for (const channelId of channels) {
    const result = await syncChannelTypes(workspaceId, channelId).catch(() => ({ ok: false }));
    if (!result.ok) failed.push(channelId);
  }
  // Never a silent cap: the caller is told what was left for a later re-sync.
  return { channels, failed, truncated: all.length > channels.length };
}

/**
 * POST /types/:name/deprecate — retire a type across the whole workspace.
 *
 * This is the answer to "a type was approved by mistake". Re-running a channel
 * cannot undo it: the channel's set is the union of what every run on it
 * approved, so declining the type on a later run leaves the earlier approval
 * standing. Status is the only lever that removes it, because channelTypeDefs
 * narrows to APPROVED.
 *
 * The definition is kept, not deleted — entities already carry the type, and
 * `deprecatedReason` is the record of why it stopped being offered.
 */
router.post("/types/:name/deprecate", async (req: Request, res: Response) => {
  const workspaceId = await workspaceOf(req);
  if (!workspaceId) return res.status(400).json({ error: NO_WORKSPACE });

  const name = normalizeTypeName(String(req.params["name"] ?? ""));
  const reason = String((req.body ?? {}).reason ?? "").trim();
  // The schema documents deprecatedReason as required when DEPRECATED, and a
  // retired type with no stated reason is exactly the thing nobody can safely
  // undo six months later.
  if (!reason) {
    return res.status(400).json({ error: "A reason is required to deprecate a type" });
  }

  const existing = await prisma.entityTypeDefinition.findUnique({
    where: { workspaceId_name: { workspaceId, name } },
  });
  if (!existing) return res.status(404).json({ error: `No type named ${name} in this workspace` });

  await prisma.entityTypeDefinition.update({
    where: { workspaceId_name: { workspaceId, name } },
    data: { status: "DEPRECATED", deprecatedReason: reason.slice(0, 1000) },
  });

  const resync = await resyncChannelsReferencing(workspaceId, name);

  logger.info("[entity-extraction-api] type deprecated", {
    name,
    channelsResynced: resync.channels.length,
    resyncFailed: resync.failed.length,
    truncated: resync.truncated,
  });
  return res.json({
    name,
    status: "DEPRECATED",
    channelsResynced: resync.channels.length,
    ...(resync.failed.length ? { resyncFailedChannels: resync.failed } : {}),
    ...(resync.truncated
      ? { warning: `More than 200 channels reference ${name}; the rest need a manual re-sync.` }
      : {}),
  });
});

/** POST /types/:name/restore — undo a deprecation, and put it back on its channels. */
router.post("/types/:name/restore", async (req: Request, res: Response) => {
  const workspaceId = await workspaceOf(req);
  if (!workspaceId) return res.status(400).json({ error: NO_WORKSPACE });

  const name = normalizeTypeName(String(req.params["name"] ?? ""));
  const existing = await prisma.entityTypeDefinition.findUnique({
    where: { workspaceId_name: { workspaceId, name } },
  });
  if (!existing) return res.status(404).json({ error: `No type named ${name} in this workspace` });

  await prisma.entityTypeDefinition.update({
    where: { workspaceId_name: { workspaceId, name } },
    data: { status: "APPROVED", deprecatedReason: null },
  });

  const resync = await resyncChannelsReferencing(workspaceId, name);

  logger.info("[entity-extraction-api] type restored", {
    name,
    channelsResynced: resync.channels.length,
  });
  return res.json({ name, status: "APPROVED", channelsResynced: resync.channels.length });
});

/**
 * DELETE /channels/:channelId/types/:name — drop one type from ONE channel.
 *
 * Distinct from deprecation: the type stays valid everywhere else. "GATEWAY is
 * a real type, it just isn't what this channel is about" is a different
 * statement from "GATEWAY was a mistake".
 *
 * The channel's set is derived from `approvedTypeNames` across its runs, so the
 * name is stripped from each of them. That rewrites history slightly — the run
 * no longer claims an approval it made — which is the tradeoff for keeping the
 * channel projection derived rather than storing a second copy of it.
 */
router.delete("/channels/:channelId/types/:name", async (req: Request, res: Response) => {
  const channelId = String(req.params["channelId"] ?? "");
  const workspaceId = await workspaceForChannel(req, channelId);
  if (!workspaceId) return res.status(400).json({ error: NO_WORKSPACE });

  const name = normalizeTypeName(String(req.params["name"] ?? ""));

  const runs = await prisma.entityExtractionRun.findMany({
    where: { workspaceId, channelId, approvedTypeNames: { has: name } },
    select: { id: true, approvedTypeNames: true },
  });
  if (runs.length === 0) {
    return res.status(404).json({ error: `${name} is not approved on this channel` });
  }

  for (const run of runs) {
    await prisma.entityExtractionRun.update({
      where: { id: run.id },
      data: { approvedTypeNames: run.approvedTypeNames.filter((t) => t !== name) },
    });
  }

  const sync = await syncChannelTypes(workspaceId, channelId);

  logger.info("[entity-extraction-api] type removed from channel", {
    channelId,
    name,
    runsUpdated: runs.length,
    vespaSynced: sync.ok,
  });
  return res.json({
    channelId,
    removed: name,
    runsUpdated: runs.length,
    entityTypes: sync.entityTypes,
    vespaSync: sync.ok ? "ok" : "failed",
    ...(sync.error ? { vespaSyncError: sync.error } : {}),
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
