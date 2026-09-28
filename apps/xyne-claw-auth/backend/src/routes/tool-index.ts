import { Router, type Request, type Response } from "express";
import { getOrgId, getRequesterId, isClawAdmin } from "../middleware/agent-acl.js";
import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";
import { prisma } from "../db.js";
import {
  listTools,
  rebuildToolIndex,
  searchTools,
  toolIndexBankConfig,
  toolIndexBankId,
} from "../services/tool-index/index.js";

const log = createLogger("tool-index-routes");

/**
 * Operator surface for the tool catalog index. Agent-facing search lives on
 * the session-scoped route in mcp.ts instead — that one carries a run's org.
 */
export const toolIndexRouter: Router = Router();

async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  const requesterId = getRequesterId(req);
  if (requesterId && (await isClawAdmin(requesterId))) return true;
  res.status(403).json({ success: false, error: "Admin access required" });
  return false;
}

function fail(res: Response, err: unknown, what: string): void {
  log.warn(`[tool-index] ${what} failed: ${errMsg(err)}`);
  res.status(500).json({ success: false, error: errMsg(err) });
}

/** Catalog size against what the bank holds, plus the bank's resolved config. */
toolIndexRouter.get("/overview", async (_req, res) => {
  try {
    const [tools, enabled, bankConfig] = await Promise.all([
      prisma.tool.count(),
      prisma.tool.count({ where: { enabled: true } }),
      toolIndexBankConfig().catch(() => ({})),
    ]);
    res.json({ success: true, data: { tools, enabled, bankId: toolIndexBankId(), bankConfig } });
  } catch (err) {
    fail(res, err, "overview");
  }
});

/** Full rebuild. Idempotent — unchanged tools are skipped by content hash. */
toolIndexRouter.post("/rebuild", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    res.json({ success: true, data: await rebuildToolIndex() });
  } catch (err) {
    fail(res, err, "rebuild");
  }
});

/** Recall tester — the debug loop for "why was my tool not found?". */
toolIndexRouter.post("/search", async (req, res) => {
  try {
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    const orgId = getOrgId(req);
    const opts = { limit: Number(req.body?.limit) || 10, ...(orgId ? { orgId } : {}) };
    const matches = query ? await searchTools(query, opts) : await listTools(opts);
    res.json({ success: true, data: { mode: query ? "search" : "list", matches } });
  } catch (err) {
    fail(res, err, "search");
  }
});
