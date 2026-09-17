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
import { getUsagePatternFile, synthesizeUsagePatterns, writeUsagePatternFile } from "../services/usage-patterns/index.js";

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
    const outcome = await synthesizeUsagePatterns(orgId, req.params.slug, window);
    res.json({
      success: true,
      data: { ...outcome, window: { start: window.start.toISOString(), end: window.end.toISOString() } },
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
    res.json({ success: true, data: await getUsagePatternFile(orgId, req.params.slug) });
  } catch (err) {
    fail(res, err, `usage-patterns file ${req.params.slug}`);
  }
});
