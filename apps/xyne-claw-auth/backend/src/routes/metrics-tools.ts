/**
 * Tool-level, LLM-call and session drill-down metrics for the v3 Metrics page
 * (run-level cards live in routes/metrics.ts), mounted beside metricsRouter.
 * Every GET resolves ONE window through metrics-core and answers with
 * `window: WindowInfo` first. Aggregates are cached per scope and window;
 * sort, search and paging of the tool table run on the cached rollup.
 */

import { Router, type Request, type Response } from "express";
import { isClawAdmin } from "../middleware/agent-acl.js";
import { getRequesterAliases } from "../middleware/pin-user-id-param.js";
import {
  METRIC_TTL,
  cachedMetric,
  parseIntParam,
  resolveRequestWindow,
  windowInfo,
  type AnalyticsWindow,
} from "../lib/metrics-core.js";
import {
  MetricsBadRequestError,
  TOOL_SORT_KEYS,
  assertExactCitationsAllowed,
  backfillToolStats,
  fetchCitations,
  fetchErrorClasses,
  fetchToolRollup,
  fetchToolStatsCoverage,
  fetchUnusedGrants,
  pageToolRows,
  type ToolSortKey,
} from "../lib/tool-analytics.js";
import { fetchLlmCalls } from "../lib/llm-call-analytics.js";
import { fetchMetricSessions, type SessionKind, type ToolSignal } from "../lib/metric-sessions.js";
import { createLogger } from "../logger.js";

const log = createLogger("metrics-tools");

export const metricsToolsRouter = Router();

const CACHE_CONTROL = "private, max-age=30";

/** `tools/rollup` is shared with the legacy toolLatency in routes/metrics.ts. */
const KEY = {
  toolRollup: "tools/rollup",
  toolCoverage: "tools/coverage",
  errorClasses: "tools/error-classes",
  citations: "tools/citations",
  unusedGrants: "tools/unused-grants",
  llmCalls: "llm-calls",
} as const;

const EXACT_CITATIONS_TTL_MS = 10 * 60_000;

const DEFAULT_TOOL_PAGE = 50;
const MAX_TOOL_PAGE = 200;

function sendError(res: Response, tag: string, err: unknown): void {
  const message = err instanceof Error ? err.message : "Internal server error";
  const status = err instanceof MetricsBadRequestError
    ? 400
    : message === "x-user-id header is required" ? 401 : message === "orgId is required" ? 400 : 500;
  if (status === 500) log.error(`[metrics${tag}] error:`, err);
  res.status(status).json({ error: message });
}

const flag = (v: unknown): boolean => v === "1" || v === "true";

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/** Repeated or comma-separated query values. */
function list(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : [v];
  return raw.filter((x): x is string => typeof x === "string").flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
}

const rollupBlock = (w: AnalyticsWindow) =>
  cachedMetric({ endpoint: KEY.toolRollup, window: w }, METRIC_TTL.current, () => fetchToolRollup(w));
const coverageBlock = (w: AnalyticsWindow) =>
  cachedMetric({ endpoint: KEY.toolCoverage, window: w }, METRIC_TTL.current, () => fetchToolStatsCoverage(w));

/** GET /tools?sort=&dir=&limit=&offset=&search= — one page of per-tool rows, totals, rankings and coverage. */
metricsToolsRouter.get("/tools", async (req: Request, res: Response) => {
  try {
    const { window, scope, days, agentSlugs } = await resolveRequestWindow(req, "/metrics/tools");
    const rawSort = String(req.query["sort"] ?? "");
    const sort: ToolSortKey = (TOOL_SORT_KEYS as readonly string[]).includes(rawSort) ? (rawSort as ToolSortKey) : "errors";
    const dir = req.query["dir"] === "asc" ? "asc" : "desc";
    const limit = parseIntParam(req.query["limit"], DEFAULT_TOOL_PAGE, 1, MAX_TOOL_PAGE);
    const offset = parseIntParam(req.query["offset"], 0, 0, Number.MAX_SAFE_INTEGER);
    const search = str(req.query["search"]);

    const [rollup, coverage] = await Promise.all([rollupBlock(window), coverageBlock(window)]);
    const page = pageToolRows(rollup.value.rows, { sort, dir, limit, offset, search });
    res.set("Cache-Control", CACHE_CONTROL).json({
      window: windowInfo(window, scope, days, agentSlugs, rollup.cached && coverage.cached),
      coverage: coverage.value,
      totals: rollup.value.totals,
      page: { limit, offset, total: page.total, sort, dir },
      rows: page.rows,
      ranking: rollup.value.ranking,
    });
  } catch (err) {
    sendError(res, "/tools", err);
  }
});

/** GET /tools/error-classes?tool=&limit=&offset=&perTool= — `tool` narrows to one tool, `perTool` caps classes per tool. */
metricsToolsRouter.get("/tools/error-classes", async (req: Request, res: Response) => {
  try {
    const { window, scope, days, agentSlugs } = await resolveRequestWindow(req, "/metrics/tools/error-classes");
    const tool = str(req.query["tool"])?.slice(0, 200);
    const limit = parseIntParam(req.query["limit"], 50, 1, MAX_TOOL_PAGE);
    const offset = parseIntParam(req.query["offset"], 0, 0, Number.MAX_SAFE_INTEGER);
    const perTool = req.query["perTool"] !== undefined ? parseIntParam(req.query["perTool"], 5, 1, 50) : undefined;
    const params = { tool: tool ?? null, limit, offset, perTool: perTool ?? null };
    const { value, cached } = await cachedMetric({ endpoint: KEY.errorClasses, window, params }, METRIC_TTL.current, () =>
      fetchErrorClasses(window, { tool, limit, offset, perTool }));
    res.set("Cache-Control", CACHE_CONTROL).json({ window: windowInfo(window, scope, days, agentSlugs, cached), ...value });
  } catch (err) {
    sendError(res, "/tools/error-classes", err);
  }
});

/** GET /tools/citations?exact=1 — `exact=1` adds the conversation-scoped join, refused (400) unless the window is small enough. */
metricsToolsRouter.get("/tools/citations", async (req: Request, res: Response) => {
  try {
    const { window, scope, days, agentSlugs } = await resolveRequestWindow(req, "/metrics/tools/citations");
    const exact = flag(req.query["exact"]);
    if (exact) assertExactCitationsAllowed(window);
    const { value, cached } = await cachedMetric(
      { endpoint: KEY.citations, window, params: { exact } },
      exact ? EXACT_CITATIONS_TTL_MS : METRIC_TTL.current,
      () => fetchCitations(window, { exact, rollup: async () => (await rollupBlock(window)).value }),
    );
    res.set("Cache-Control", CACHE_CONTROL).json({ window: windowInfo(window, scope, days, agentSlugs, cached), ...value });
  } catch (err) {
    sendError(res, "/tools/citations", err);
  }
});

/** GET /tools/unused-grants — grants never exercised in the window. */
metricsToolsRouter.get("/tools/unused-grants", async (req: Request, res: Response) => {
  try {
    const { window, scope, days, agentSlugs } = await resolveRequestWindow(req, "/metrics/tools/unused-grants");
    const { value, cached } = await cachedMetric({ endpoint: KEY.unusedGrants, window }, METRIC_TTL.current, () => fetchUnusedGrants(window));
    res.set("Cache-Control", CACHE_CONTROL).json({ window: windowInfo(window, scope, days, agentSlugs, cached), ...value });
  } catch (err) {
    sendError(res, "/tools/unused-grants", err);
  }
});

/** GET /llm-calls?includeSubagents=1 */
metricsToolsRouter.get("/llm-calls", async (req: Request, res: Response) => {
  try {
    const { window, scope, days, agentSlugs } = await resolveRequestWindow(req, "/metrics/llm-calls");
    const includeSubagents = flag(req.query["includeSubagents"]);
    const { value, cached } = await cachedMetric({ endpoint: KEY.llmCalls, window, params: { includeSubagents } }, METRIC_TTL.current, () =>
      fetchLlmCalls(window, { includeSubagents }));
    res.set("Cache-Control", CACHE_CONTROL).json({ window: windowInfo(window, scope, days, agentSlugs, cached), ...value });
  } catch (err) {
    sendError(res, "/llm-calls", err);
  }
});

/** GET /sessions?kind=tool|failed|slow|model&tool=&signal=&errorClass=&status=&minMs=&model=&provider=&limit=&cursor=&count=1 — never cached (keyset pages). */
metricsToolsRouter.get("/sessions", async (req: Request, res: Response) => {
  try {
    const { window, scope, days, agentSlugs } = await resolveRequestWindow(req, "/metrics/sessions");
    const minMs = req.query["minMs"] !== undefined ? Number(req.query["minMs"]) : undefined;
    const result = await fetchMetricSessions(
      window,
      {
        kind: String(req.query["kind"] ?? "") as SessionKind,
        tool: str(req.query["tool"]),
        signal: str(req.query["signal"]) as ToolSignal | undefined,
        errorClass: str(req.query["errorClass"]),
        status: list(req.query["status"]) as Array<"failed" | "cancelled">,
        minMs: Number.isFinite(minMs) ? minMs : undefined,
        model: str(req.query["model"]),
        provider: str(req.query["provider"]),
        limit: parseIntParam(req.query["limit"], 25, 1, 50),
        cursor: str(req.query["cursor"]),
        count: flag(req.query["count"]),
      },
      { requesterAliases: getRequesterAliases(req), isAdmin: scope.isAdmin },
    );
    res.json({ window: windowInfo(window, scope, days, agentSlugs, false), ...result });
  } catch (err) {
    sendError(res, "/sessions", err);
  }
});

/** POST /tools/backfill (CLAW_ADMIN) — writes agent_run_stats rows for runs lacking one; resumable. Body: { batchSize, maxRows, pauseMs, sinceDays, force } */
metricsToolsRouter.post("/tools/backfill", async (req: Request, res: Response) => {
  try {
    const userId = String(req.headers["x-user-id"] ?? "");
    if (!userId) { res.status(401).json({ error: "x-user-id header is required" }); return; }
    if (!(await isClawAdmin(userId))) { res.status(403).json({ error: "Admin required" }); return; }

    const body = (req.body ?? {}) as { batchSize?: unknown; maxRows?: unknown; pauseMs?: unknown; sinceDays?: unknown; force?: unknown };
    const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    const report = await backfillToolStats({
      ...(finite(body.batchSize) ? { batchSize: Math.min(Math.max(Math.trunc(body.batchSize), 1), 1000) } : {}),
      ...(finite(body.maxRows) ? { maxRows: Math.max(Math.trunc(body.maxRows), 0) } : {}),
      ...(finite(body.pauseMs) ? { pauseMs: Math.min(Math.max(body.pauseMs, 0), 5000) } : {}),
      ...(finite(body.sinceDays) && body.sinceDays > 0 ? { since: new Date(Date.now() - body.sinceDays * 24 * 60 * 60 * 1000) } : {}),
      ...(body.force === true ? { force: true } : {}),
    });
    res.json(report);
  } catch (err) {
    sendError(res, "/tools/backfill", err);
  }
});
