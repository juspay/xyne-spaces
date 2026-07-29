/**
 * Search Evals — run creation (background job) + status/results polling.
 */
import { Router, type Request, type Response } from "express";
import { searchEvalRepository, computeSearchEvalSummary, toMetricsSummary, type SearchEvalRunSummary } from "../../repositories/index.js";
import { getRequesterId, getOrgId } from "../../middleware/agent-acl.js";
import { enqueueSearchEvalRun, getSearchEvalRunStatus } from "../../queue/search-eval-run-queue.js";

import { createLogger } from "../../logger.js";
const log = createLogger("search-evals/runs");

const router = Router();

// Every `inputs {}` name declared across the per-schema `tunable` rank
// profiles (message/ticket/file/mail — chat_container has no tunable
// profile), read off the deployed .sd schemas — see the ground-truth comment
// in vespa-search-areas.ts and TUNABLE_INPUTS_BY_AREA in the frontend
// (SearchEvalsPageV3.tsx), which is the single source of truth for the field
// list this must stay in sync with. Union across all types rather than
// per-type here since Vespa silently ignores unrecognized input.query(<name>)
// params (confirmed via direct curl testing — see search-eval-vespa.ts) — an
// over-broad allow-list can't leak a key into the wrong schema's query.
const TUNABLE_RANK_INPUT_KEYS = new Set([
  // message
  "w_vector", "w_bm25", "w_prox", "w_time_range", "alpha_const", "slack_vector_decay",
  "weight_text", "weight_username", "weight_channel_name", "prox_weight", "prox_decay_t", "saturation_point",
  // ticket (adds)
  "weight_people", "weight_mentions", "weight_context", "weight_tags", "weight_other", "ticket_vector_decay", "id_weight",
  // file (adds)
  "weight_filename", "weight_chunks", "weight_description", "weight_image_chunks", "w_recency",
  // mail (adds)
  "weight_entity", "weight_attachment", "subject_native_weight", "chunks_native_weight", "max_doc_decay",
  "w_people_from", "w_people_to", "w_people_cc_bcc",
]);

function parseRankProfileInputs(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!TUNABLE_RANK_INPUT_KEYS.has(k)) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// GET /search-evals/sheets/:id/runs — run history for a sheet (newest first)
router.get("/sheets/:id/runs", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const [sheet, runs] = await Promise.all([
      searchEvalRepository.getSheet(req.params.id),
      searchEvalRepository.listRunsForSheet(req.params.id),
    ]);
    const queriesTotal = sheet?.queries.length ?? 0;
    res.json({
      success: true,
      runs: runs.map(({ queriesScored, top1Count, top1Pct, top3Count, top3Pct, top10Count, top10Pct, mrr, ...run }) => ({
        ...run,
        summary: queriesScored != null
          ? toMetricsSummary({ queriesScored, top1Count, top1Pct, top3Count, top3Pct, top10Count, top10Pct, mrr }, queriesTotal)
          : null,
      })),
    });
  } catch (err) {
    log.error("[search-evals] listRunsForSheet error:", err);
    res.status(500).json({ success: false, error: "Failed to list runs" });
  }
});

// POST /search-evals/sheets/:id/runs — kick off a background run
router.post("/sheets/:id/runs", async (req: Request<{ id: string }>, res: Response) => {
  const orgId = getOrgId(req);
  const userId = getRequesterId(req);
  if (!orgId || !userId) {
    res.status(400).json({ success: false, error: "Could not resolve requester/org for this request" });
    return;
  }
  const { queryType, rankProfile, rankProfileInputs } = req.body as {
    queryType?: unknown;
    rankProfile?: unknown;
    rankProfileInputs?: unknown;
  };
  const typeList = Array.isArray(queryType) ? queryType.filter((t): t is string => typeof t === "string") : [];
  const rankProfileValue = typeof rankProfile === "string" && rankProfile.trim() ? rankProfile.trim() : null;
  const rankProfileInputsValue = parseRankProfileInputs(rankProfileInputs);

  try {
    const sheet = await searchEvalRepository.getSheet(req.params.id);
    if (!sheet) {
      res.status(404).json({ success: false, error: "Sheet not found" });
      return;
    }
    // Permission mode + as-of are fixed on the sheet at upload time, not chosen per run.
    const permissionMode = sheet.permissionMode as "with" | "without";
    const asOf = sheet.asOfTimestamp;
    const run = await searchEvalRepository.createRun({
      sheetId: sheet.id,
      orgId,
      queryType: typeList,
      rankProfile: rankProfileValue,
      rankProfileInputs: rankProfileInputsValue,
      permissionMode,
      asOfTimestamp: asOf,
      createdBy: userId,
    });
    const jobId = await enqueueSearchEvalRun({
      runId: run.id,
      sheetId: sheet.id,
      permissionMode,
      queryType: typeList,
      rankProfile: rankProfileValue,
      rankProfileInputs: rankProfileInputsValue,
      asOfTimestamp: asOf ? asOf.toISOString() : null,
      userId,
    });
    res.json({ success: true, runId: run.id, jobId });
  } catch (err) {
    log.error("[search-evals] createRun error:", err);
    res.status(500).json({ success: false, error: "Failed to start run" });
  }
});

// GET /search-evals/runs/:id — status + progress, and results once available
router.get("/runs/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const run = await searchEvalRepository.getRunWithResults(req.params.id);
    if (!run) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }
    const jobStatus = await getSearchEvalRunStatus(run.id).catch(() => null);

    const resultsByQueryId = new Map(run.results.map((r) => [r.queryId, r]));
    const rows = run.sheet.queries.map((q) => {
      const result = resultsByQueryId.get(q.id);
      return {
        queryId: q.id,
        query: q.query,
        goldAnswer: q.goldAnswer,
        goldId: q.goldId,
        hit: result?.hit ?? null,
        rank: result?.rank ?? null,
        topResults: result?.topResults ?? null,
        debug: result?.debug ?? null,
      };
    });
    // Prefer the persisted columns (stamped alongside completedAt when the
    // worker finished) over recomputing — falls back to a live computation
    // for in-progress runs (not written yet) and any pre-existing runs from
    // before these columns existed.
    const summary: SearchEvalRunSummary = run.queriesScored != null
      ? toMetricsSummary(run, rows.length)
      : computeSearchEvalSummary(rows);

    res.json({
      success: true,
      run: {
        id: run.id,
        sheetId: run.sheetId,
        sheetName: run.sheet.name,
        sheetDescription: run.sheet.description,
        status: run.status,
        permissionMode: run.permissionMode,
        queryType: run.queryType,
        rankProfile: run.rankProfile,
        rankProfileInputs: run.rankProfileInputs,
        asOfTimestamp: run.asOfTimestamp,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      },
      progress: jobStatus?.progress ?? null,
      summary,
      rows,
    });
  } catch (err) {
    log.error("[search-evals] getRun error:", err);
    res.status(500).json({ success: false, error: "Failed to load run" });
  }
});

export { router as searchEvalRunsRouter };
