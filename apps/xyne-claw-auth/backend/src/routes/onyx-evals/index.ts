/**
 * Onyx Evals router (EnterpriseRAG-Bench) — mounted behind requireAuth +
 * requireClawAdmin in main.ts (same gating as /evals; benchmark truth must
 * not be user-mutable).
 *
 * Endpoint shape mirrors the other eval routers: start a run (queued, not
 * in-memory), poll run rows from the DB, stop/resume via the BullMQ cancel
 * machine. The dataset (questions.jsonl + dsid_mapping.json) is uploaded
 * once per run from the browser: parsed locally, posted in chunks
 * (/datasets/upload), and folded into run.config — nothing benchmark-specific
 * ships with this deployment.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getRequesterId, getOrgId } from "../../middleware/agent-acl.js";
import * as store from "../../services/onyx/onyxEvalStore.js";
import {
  enqueueOnyxEvalRun,
  cancelOnyxEvalRun,
  isOnyxCancelRequested,
} from "../../queue/onyx-eval-queue.js";

const router = Router();

// ─── Schemas ────────────────────────────────────────────────────────────────

const questionSchema = z.object({
  questionId: z.string().min(1),
  questionType: z.string().min(1).default("unknown"),
  sourceTypes: z.array(z.string()).default([]),
  question: z.string().min(1),
  expectedDocIds: z.array(z.string()).default([]),
  goldAnswer: z.string().default(""),
  answerFacts: z.array(z.string()).default([]),
});

const dsidEntrySchema = z.object({
  sourceType: z.string().min(1),
  syntheticId: z.string().min(1),
});

const runSchema = z.object({
  /** The question slice to evaluate — the whole benchmark or any subset. */
  questions: z.array(questionSchema).min(1).max(2000),
  /**
   * dsid → [{ sourceType, syntheticId }] — the browser extracts ONLY the
   * gold entries the posted questions actually reference from dsid_mapping.json,
   * so it stays tiny (≈420 entries for the full 500-question release).
   */
  dsidMapping: z.record(z.string(), z.array(dsidEntrySchema)).default({}),
  topK: z.number().int().min(1).max(25).default(10),
  rankProfile: z.string().trim().min(1).default("default_native"),
  concurrency: z.number().int().min(1).max(4).default(2),
  threeJudgeCorrection: z.boolean().default(true),
  model: z.string().trim().min(1).optional(),
}).strict();

// ─── Run control ────────────────────────────────────────────────────────────

router.post("/run", async (req: Request, res: Response): Promise<void> => {
  const parsed = runSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "invalid run payload", details: parsed.error.flatten() });
    return;
  }
  // Dataset integrity: every gold id must resolve through the posted mapping
  // (the dataset's own invariant — anything missing is an unscoreable question).
  const missingDsids: string[] = [];
  const seen = new Set<string>();
  for (const q of parsed.data.questions) {
    for (const dsid of q.expectedDocIds) {
      if (seen.has(dsid) || parsed.data.dsidMapping[dsid]) continue;
      seen.add(dsid);
      missingDsids.push(dsid);
    }
  }
  if (missingDsids.length > 0) {
    res.status(400).json({
      success: false,
      error: `${missingDsids.length} expected_doc_id(s) have no dsidMapping entry — re-upload the mapping for these ids.`,
      missingDsids: missingDsids.slice(0, 20),
    });
    return;
  }

  const runId = await store.createRun({
    config: parsed.data,
    totalQuestions: parsed.data.questions.length,
    createdBy: getRequesterId(req),
    orgId: getOrgId(req),
  });
  const jobId = await enqueueOnyxEvalRun({ runId, userId: getRequesterId(req) ?? "unknown" });
  await store.attachJobId(runId, jobId);
  res.status(202).json({ success: true, runId, jobId, totalQuestions: parsed.data.questions.length });
});

router.post("/runs/:runId/stop", async (req: Request, res: Response): Promise<void> => {
  const runId = String(req.params["runId"]);
  const run = await store.getRun(runId);
  if (!run) { res.status(404).json({ success: false, error: "run not found" }); return; }
  const jobId = (run.config as Record<string, unknown> | null)?.["jobId"];
  if (typeof jobId !== "string") {
    res.status(409).json({ success: false, error: "run has no active job" });
    return;
  }
  const ok = await cancelOnyxEvalRun(jobId);
  res.json({ success: ok, status: "stopping" });
});

/**
 * POST /runs/resume | /runs/:runId/resume — pick the latest non-completed run
 * (or the given one) and re-enqueue; the worker skips questionIds whose rows
 * already exist, so failed questions get re-attempted in-place.
 */
async function startResume(req: Request, res: Response): Promise<void> {
  const runIdParam = (req.params["runId"] as string | undefined) ?? undefined;
  const run = runIdParam
    ? await store.getRun(runIdParam)
    : await store.findResumableRun();
  if (!run) {
    res.status(404).json({ success: false, error: runIdParam ? `run ${runIdParam} not found` : "no resumable run (latest is already completed)" });
    return;
  }
  if (run.status === "completed") {
    res.status(409).json({ success: false, error: `run ${run.id} is already completed` });
    return;
  }
  const cfg = store.parseRunConfig(run.config);
  if (!cfg) {
    res.status(500).json({ success: false, error: "run config is unparseable — cannot resume" });
    return;
  }
  await store.reopenRun(run.id);
  const jobId = await enqueueOnyxEvalRun({ runId: run.id, userId: getRequesterId(req) ?? "unknown" });
  await store.attachJobId(run.id, jobId);
  res.status(202).json({ success: true, runId: run.id, jobId, remaining: cfg.questions.length - (await store.getDoneQuestionIds(run.id)).size });
}
router.post("/runs/resume", startResume);
router.post("/runs/:runId/resume", startResume);

// ─── Read side ──────────────────────────────────────────────────────────────

router.get("/runs", async (req: Request, res: Response): Promise<void> => {
  const take = Math.min(Number(req.query["limit"] ?? 20) || 20, 100);
  const runs = (await store.listRuns(take)).map((r) => {
    const jobId = (r.config as Record<string, unknown> | null)?.["jobId"];
    const { config: _config, ...rest } = r; // don't ship question payloads back
    return { ...rest, jobId: typeof jobId === "string" ? jobId : null };
  });
  res.json({ success: true, runs });
});

router.get("/runs/:runId", async (req: Request, res: Response): Promise<void> => {
  const run = await store.getRun(String(req.params["runId"]));
  if (!run) { res.status(404).json({ success: false, error: "run not found" }); return; }
  const jobId = (run.config as Record<string, unknown> | null)?.["jobId"];
  const cancelled = typeof jobId === "string" ? await isOnyxCancelRequested(jobId) : false;
  const { config: _config, ...summary } = run;
  res.json({ success: true, run: { ...summary, jobId: typeof jobId === "string" ? jobId : null, cancelRequested: cancelled } });
});

router.get("/runs/:runId/questions", async (req: Request, res: Response): Promise<void> => {
  const page = Math.max(Number(req.query["page"] ?? 0) || 0, 0);
  const pageSize = Math.min(Math.max(Number(req.query["pageSize"] ?? 50) || 50, 1), 200);
  const type = typeof req.query["type"] === "string" && req.query["type"] ? req.query["type"] : undefined;
  const { total, rows } = await store.getRunQuestions(String(req.params["runId"]), page, pageSize, type);
  res.json({ success: true, total, page, pageSize, questions: rows });
});

router.get("/runs/:runId/questions/:questionId", async (req: Request, res: Response): Promise<void> => {
  const row = await store.getRunQuestionDetail(String(req.params["runId"]), String(req.params["questionId"]));
  if (!row) { res.status(404).json({ success: false, error: "question not found" }); return; }
  res.json({ success: true, question: row });
});

export { router as onyxEvalsRouter };
