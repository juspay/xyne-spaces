import { Router, type Request, type Response } from "express";
import { getOrgId, getRequesterId, isClawAdmin } from "../middleware/agent-acl.js";
import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";
import {
  agentIndexBankConfig,
  agentIndexBankId,
  agentIndexDetail,
  findAgents,
  orgIndexCoverage,
  rebuildOrgIndex,
  syncAgentToIndex,
} from "../services/agent-index/index.js";
import {
  activeAgents,
  allOrgAgents,
  getUsagePatternFile,
  startUsagePatternSynthesis,
  usagePatternJob,
  weekBucket,
  writeUsagePatternFile,
  type ActiveAgent,
} from "../services/usage-patterns/index.js";
import { enqueueUsagePatternSync, usagePatternQueueStats } from "../queue/usage-pattern-queue.js";
import { CONFIG } from "../config.js";

const log = createLogger("agent-index-routes");

export const agentIndexRouter: Router = Router();

/**
 * Kept off the `/memory/banks/:agentSlug/*` routes deliberately. Those carry
 * twin privacy gates keyed on bank id, where a shared bank reached without
 * per-user scoping exposes personal memories. The index bank has no user
 * dimension at all, so it gets its own org-scoped surface rather than a second
 * bank kind threaded through those checks.
 */

function requireOrg(req: Request, res: Response): string | null {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(400).json({ success: false, error: "Organization context is required" });
    return null;
  }
  return orgId;
}

async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  const requesterId = getRequesterId(req);
  if (requesterId && (await isClawAdmin(requesterId))) return true;
  res.status(403).json({ success: false, error: "Admin access required" });
  return false;
}

function fail(res: Response, err: unknown, what: string): void {
  log.warn(`[agent-index] ${what} failed: ${errMsg(err)}`);
  res.status(500).json({ success: false, error: errMsg(err) });
}

/** Coverage, staleness and the bank's resolved configuration. */
agentIndexRouter.get("/overview", async (req, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  try {
    const [coverage, bankConfig] = await Promise.all([
      orgIndexCoverage(orgId),
      agentIndexBankConfig(orgId).catch(() => ({})),
    ]);
    res.json({ success: true, data: { ...coverage, bankId: agentIndexBankId(orgId), bankConfig } });
  } catch (err) {
    fail(res, err, "overview");
  }
});

/** Every stored entry, for the inventory table. */
agentIndexRouter.get("/agents/:slug", async (req: Request<{ slug: string }>, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  try {
    const detail = await agentIndexDetail(orgId, req.params.slug);
    if (!detail) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    res.json({ success: true, data: detail });
  } catch (err) {
    fail(res, err, `detail ${req.params.slug}`);
  }
});

agentIndexRouter.post("/agents/:slug/sync", async (req: Request<{ slug: string }>, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  if (!(await requireAdmin(req, res))) return;
  try {
    const detail = await agentIndexDetail(orgId, req.params.slug);
    if (!detail) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    res.json({ success: true, data: await syncAgentToIndex(detail.status.agentId, orgId) });
  } catch (err) {
    fail(res, err, `sync ${req.params.slug}`);
  }
});

agentIndexRouter.post("/rebuild", async (req, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  if (!(await requireAdmin(req, res))) return;
  try {
    res.json({ success: true, data: await rebuildOrgIndex(orgId) });
  } catch (err) {
    fail(res, err, "rebuild");
  }
});

/** Recall tester — the debug loop for "why was my agent not found?". */
agentIndexRouter.post("/search", async (req, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  const need = typeof req.body?.need === "string" ? req.body.need.trim() : "";
  if (!need) {
    res.status(400).json({ success: false, error: "`need` is required" });
    return;
  }
  try {
    const limit = Number(req.body?.limit) || 10;
    res.json({ success: true, data: { matches: await findAgents(orgId, need, { limit }) } });
  } catch (err) {
    fail(res, err, "search");
  }
});

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;

function parseWindow(body: unknown): { start: Date; end: Date } | string {
  const raw = (body ?? {}) as { start?: unknown; end?: unknown };
  const now = Date.now();

  const read = (value: unknown, label: string): Date | string | null => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") return `\`${label}\` must be an ISO date string`;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? `\`${label}\` is not a valid ISO date` : date;
  };

  const end = read(raw.end, "end");
  if (typeof end === "string") return end;
  const start = read(raw.start, "start");
  if (typeof start === "string") return start;

  const endAt = end ?? new Date(now);
  const startAt = start ?? new Date(endAt.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);

  if (startAt.getTime() > now) return "`start` cannot be in the future";
  if (endAt.getTime() <= startAt.getTime()) return "`end` must be after `start`";
  if (endAt.getTime() - startAt.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
    return `The window cannot be longer than ${MAX_WINDOW_DAYS} days`;
  }
  return { start: startAt, end: endAt };
}

/**
 * Fleet trigger: enqueue a synthesis pass for every agent in this org that has
 * enough recent runs to clear the thresholds.
 *
 * Queued, not started. The per-agent route below answers a human waiting on one
 * result and refuses work when it is saturated, which is the right answer for a
 * button and the wrong one for a roster walk. Here the whole selection is
 * handed to Redis and drained by the bounded worker, so the caller returns
 * immediately and nothing is dropped on the floor.
 *
 * Idempotent within the ISO week: jobs are keyed by (org, agent, week), so
 * running this twice, or running it in a week the cron already covered, enqueues
 * nothing the second time. `force: true` overrides that.
 */
agentIndexRouter.post("/usage-patterns/sync-all", async (req, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  if (!(await requireAdmin(req, res))) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  // `< 1` rather than `<= 0`, because these are all counts of days or runs and
  // Math.floor would otherwise turn a fractional 0.5 into a silent 0: a zero
  // window selects nothing and a zero minRuns selects everything.
  const num = (value: unknown, fallback: number, max: number): number | string => {
    if (value === undefined || value === null || value === "") return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return "must be a whole number of at least 1";
    return Math.min(Math.floor(n), max);
  };

  const windowDays = num(body["windowDays"], CONFIG.usagePatternWindowDays, MAX_WINDOW_DAYS);
  if (typeof windowDays === "string") {
    res.status(400).json({ success: false, error: `\`windowDays\` ${windowDays}` });
    return;
  }
  // The activity lookback is a separate dial from the synthesis window: a wider
  // lookback finds more candidates, a wider window gives each one more corpus.
  const days = num(body["days"], windowDays, MAX_WINDOW_DAYS);
  if (typeof days === "string") {
    res.status(400).json({ success: false, error: `\`days\` ${days}` });
    return;
  }
  const minRuns = num(body["minRuns"], CONFIG.usagePatternMinRuns, 1000);
  if (typeof minRuns === "string") {
    res.status(400).json({ success: false, error: `\`minRuns\` ${minRuns}` });
    return;
  }
  const limit = num(body["limit"], 0, 10_000);
  if (typeof limit === "string") {
    res.status(400).json({ success: false, error: `\`limit\` ${limit}` });
    return;
  }

  const force = body["force"] === true;
  const everyAgent = body["all"] === true;

  try {
    const end = new Date();
    const start = new Date(end.getTime() - days * DAY_MS);

    let agents: ActiveAgent[];
    let considered: number;
    let droppedByLimit = 0;
    let callerRunsScanned = 0;
    let callerScanTruncated = false;

    if (everyAgent) {
      // Deliberately unfiltered. Most of these will skip on insufficient-corpus
      // once they reach the worker; that is the cost of seeding an org whose
      // runs predate the feature, and it is why this is not the default.
      const all = await allOrgAgents(orgId);
      considered = all.length;
      agents = limit > 0 ? all.slice(0, limit) : all;
      droppedByLimit = considered - agents.length;
    } else {
      const roster = await activeAgents({
        window: { start, end },
        orgId,
        minRuns,
        ...(limit > 0 ? { limit } : {}),
      });
      agents = roster.agents;
      considered = roster.considered;
      droppedByLimit = roster.droppedByLimit;
      callerRunsScanned = roster.callerRunsScanned;
      callerScanTruncated = roster.callerScanTruncated;
    }

    const bucket = weekBucket(end);
    const requestedBy = getRequesterId(req);
    let enqueued = 0;
    let duplicates = 0;
    const failed: string[] = [];

    for (const agent of agents) {
      try {
        const result = await enqueueUsagePatternSync(
          {
            orgId: agent.orgId,
            agentSlug: agent.agentSlug,
            windowDays,
            bucket,
            trigger: "manual",
            ...(requestedBy ? { requestedBy } : {}),
          },
          { force },
        );
        if (result === "enqueued") enqueued++;
        else duplicates++;
      } catch (err) {
        log.warn(`[agent-index] enqueue failed for ${agent.agentSlug}: ${errMsg(err)}`);
        failed.push(agent.agentSlug);
      }
    }

    log.info(`[agent-index] sync-all ${bucket}: ${enqueued} enqueued, ${duplicates} already queued, ${failed.length} failed`);
    res.status(202).json({
      success: true,
      data: {
        bucket,
        windowDays,
        selected: agents.length,
        considered,
        enqueued,
        duplicates,
        droppedByLimit,
        failed,
        callerRunsScanned,
        callerScanTruncated,
        queue: await usagePatternQueueStats(),
      },
    });
  } catch (err) {
    fail(res, err, "usage-patterns sync-all");
  }
});

/**
 * Progress for a bulk trigger. Queue depth is fleet-wide rather than per-org,
 * which is honest about what BullMQ knows: the counts are the drain rate, and
 * the per-agent GET below is where an individual result is read.
 */
agentIndexRouter.get("/usage-patterns/sync-all", async (req, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  if (!(await requireAdmin(req, res))) return;
  try {
    res.json({
      success: true,
      data: {
        bucket: weekBucket(new Date()),
        windowDays: CONFIG.usagePatternWindowDays,
        queue: await usagePatternQueueStats(),
      },
    });
  } catch (err) {
    fail(res, err, "usage-patterns queue stats");
  }
});

/** Manual synthesis trigger. Does LLM work, so it can take tens of seconds. */
agentIndexRouter.post("/agents/:slug/usage-patterns", async (req: Request<{ slug: string }>, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  if (!(await requireAdmin(req, res))) return;

  const window = parseWindow(req.body);
  if (typeof window === "string") {
    res.status(400).json({ success: false, error: window });
    return;
  }

  try {
    const detail = await agentIndexDetail(orgId, req.params.slug);
    if (!detail) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    // Accepted, not completed. Distilling calls an LLM and regularly takes
    // longer than the ingress will hold the connection, so awaiting it here
    // returned 504 to the browser while the pass carried on writing the file.
    // Poll the GET below for the result.
    const job = startUsagePatternSynthesis(orgId, req.params.slug, window);
    if (job.status === "busy") {
      // 429 with Retry-After rather than a queue: a caller walking the roster
      // should slow down, not pile up synthesis passes behind itself.
      res.set("Retry-After", "30").status(429).json({
        success: false,
        error: `${job.running} synthesis passes already running; retry shortly`,
      });
      return;
    }
    res.status(job.status === "running" ? 202 : 200).json({
      success: true,
      data: { job, window: { start: window.start.toISOString(), end: window.end.toISOString() } },
    });
  } catch (err) {
    fail(res, err, `usage-patterns ${req.params.slug}`);
  }
});

/**
 * Hand-edit the shared file. Marks it as human-written, which permanently stops
 * the synthesizer from overwriting it — the UI advertises that protection, so
 * this is what makes the promise real.
 */
agentIndexRouter.put("/agents/:slug/usage-patterns", async (req: Request<{ slug: string }>, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  if (!(await requireAdmin(req, res))) return;

  const content = typeof req.body?.content === "string" ? req.body.content : null;
  if (content === null) {
    res.status(400).json({ success: false, error: "`content` is required" });
    return;
  }

  try {
    const detail = await agentIndexDetail(orgId, req.params.slug);
    if (!detail) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    res.json({ success: true, data: await writeUsagePatternFile(orgId, req.params.slug, content) });
  } catch (err) {
    fail(res, err, `usage-patterns write ${req.params.slug}`);
  }
});

/** The stored shared memory file, which a human may have edited by hand. */
agentIndexRouter.get("/agents/:slug/usage-patterns", async (req: Request<{ slug: string }>, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  try {
    // `data` stays exactly the file or null. Merging the job into it turned the
    // "no file yet" answer from null into a truthy object, and every caller that
    // branches on `data` then read fields that were not there.
    //
    // `job` rides alongside as a sibling: it carries the outcome of a pass
    // started on THIS process, including the skips that write no file at all
    // (too few runs, human-edited). Null when nothing ran here, which is also
    // what a poll sees when it lands on a different replica.
    const file = await getUsagePatternFile(orgId, req.params.slug);
    res.json({ success: true, data: file, job: usagePatternJob(orgId, req.params.slug) });
  } catch (err) {
    fail(res, err, `usage-patterns file ${req.params.slug}`);
  }
});
