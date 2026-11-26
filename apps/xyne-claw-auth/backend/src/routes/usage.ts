import { Router, type Request, type Response } from "express";
import { isClawAdmin } from "../middleware/agent-acl.js";
import { parseIntParam } from "../lib/metrics-core.js";
import {
  UsageError,
  deletePrice,
  fetchSessionTimeline,
  fetchToolUsage,
  fetchUnpricedModels,
  fetchUsageBreakdown,
  fetchUsageOptions,
  fetchUsageSeries,
  fetchUsageSummary,
  ingestLlmCalls,
  listPriceHistory,
  listPrices,
  parseGroupBy,
  parsePriceInput,
  resolveUsageQuery,
  upsertPrice,
} from "../lib/llm-usage.js";
import { createLogger } from "../logger.js";

const log = createLogger("usage-routes");

/** Dashboard reads, mounted at /usage behind requireAuth. */
export const usageRouter = Router();

/** xyne-claw's per-call reports, mounted at /internal/llm-usage behind requireStrictS2S. */
export const usageInternalRouter = Router();

function sendError(res: Response, route: string, err: unknown): void {
  if (err instanceof UsageError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  log.error(`[usage${route}] error:`, err);
  res.status(500).json({ error: "usage query failed" });
}

const handle = (route: string, fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    const body = await fn(req);
    if (body === null) res.status(404).json({ error: "not found" });
    else res.set("Cache-Control", "private, no-store").json(body);
  } catch (err) {
    sendError(res, route, err);
  }
};

usageRouter.get("/summary", handle("/summary", async (req) => fetchUsageSummary(await resolveUsageQuery(req))));

usageRouter.get("/series", handle("/series", async (req) =>
  fetchUsageSeries(await resolveUsageQuery(req), parseGroupBy(req.query["groupBy"], "agent"), parseIntParam(req.query["top"], 5, 1, 12), req.query["metric"] === "tokens" ? "tokens" : "cost")));

usageRouter.get("/breakdown", handle("/breakdown", async (req) =>
  fetchUsageBreakdown(await resolveUsageQuery(req), parseGroupBy(req.query["groupBy"], "agent"), {
    sort: typeof req.query["sort"] === "string" ? req.query["sort"] : undefined,
    dir: typeof req.query["dir"] === "string" ? req.query["dir"] : undefined,
    search: typeof req.query["q"] === "string" ? req.query["q"] : undefined,
    limit: parseIntParam(req.query["limit"], 50, 1, 500),
    offset: parseIntParam(req.query["offset"], 0, 0, 1_000_000),
  })));

usageRouter.get("/sessions/:conversationId", handle("/sessions", async (req) =>
  fetchSessionTimeline(await resolveUsageQuery(req), String(req.params["conversationId"]))));

usageRouter.get("/tools", handle("/tools", async (req) => ({ rows: await fetchToolUsage(await resolveUsageQuery(req)) })));

usageRouter.get("/options", handle("/options", async (req) => fetchUsageOptions(await resolveUsageQuery(req))));

/** Prices are global (provider list prices and our own hosted models), so only claw admins edit them. */
async function requirePriceAdmin(req: Request): Promise<string> {
  const userId = String(req.headers["x-user-id"] ?? "");
  if (!userId) throw new UsageError(401, "x-user-id header is required");
  if (!(await isClawAdmin(userId))) throw new UsageError(403, "only claw admins can manage prices");
  return userId;
}

usageRouter.get("/prices", handle("/prices", async (req) => {
  const q = await resolveUsageQuery(req);
  const [prices, unpriced, history] = await Promise.all([listPrices(), q.isAdmin ? fetchUnpricedModels(q.orgId) : null, q.isAdmin ? listPriceHistory() : null]);
  return { canEdit: await isClawAdmin(String(req.headers["x-user-id"])), prices, unpriced, history };
}));

usageRouter.put("/prices", handle("/prices", async (req) => {
  const userId = await requirePriceAdmin(req);
  const input = parsePriceInput(req.body);
  if ("error" in input) throw new UsageError(400, input.error);
  return upsertPrice(input, userId);
}));

usageRouter.delete("/prices/:id", handle("/prices", async (req) => {
  const userId = await requirePriceAdmin(req);
  const repriced = await deletePrice(String(req.params["id"]), userId);
  return repriced === null ? null : { repriced };
}));

usageInternalRouter.post("/", async (req: Request, res: Response) => {
  const events = (req.body as { events?: unknown })?.events;
  if (!Array.isArray(events)) {
    res.status(400).json({ error: "events must be an array" });
    return;
  }
  try {
    res.json(await ingestLlmCalls(events));
  } catch (err) {
    log.error("[usage/ingest] error:", err);
    res.status(500).json({ error: "ingest failed" });
  }
});
