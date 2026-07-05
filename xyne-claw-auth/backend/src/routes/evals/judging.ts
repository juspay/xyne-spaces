/**
 * Evals — judging: model lists, named judges CRUD, and background scoring jobs.
 */
import { Router, type Request, type Response } from "express";
import { evalRepository, userProviderCredentialsRepository } from "../../repositories/index.js";
import { getRequesterId } from "../../middleware/agent-acl.js";
import { listEvalModels } from "../../services/evalJudgeClient.js";
import { enqueueEvalJudge, getEvalJudgeStatus, cancelEvalJudge } from "../../queue/eval-judge-queue.js";

import { createLogger } from "../../logger.js";
const log = createLogger("judging");

const router = Router();

// ── Semantic judge ──────────────────────────────────────────────────────────

// GET /evals/models — judge model picker options (proxied from claw's LiteLLM)
// + what an empty model resolves to (shown as "Default (kimi-latest)" in the UI).
router.get("/models", async (_req: Request, res: Response) => {
  try {
    const { models, defaultModel } = await listEvalModels();
    res.json({ success: true, models, defaultModel });
  } catch (err) {
    log.error("[evals] listModels error:", err);
    res.json({ success: true, models: [], defaultModel: "" });
  }
});

// GET /evals/gen-models — generation-model options for the Run dialog: the
// providers THIS USER has configured in claw (provider + the model they picked
// in Settings — no secrets), plus the platform LiteLLM models everyone has.
router.get("/gen-models", async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Unauthenticated" });
    return;
  }
  try {
    const [creds, litellmInfo] = await Promise.all([
      userProviderCredentialsRepository.listByUser(userId).catch(() => []),
      listEvalModels().catch(() => ({ models: [] as string[], defaultModel: "" })),
    ]);
    const providers = creds
      .filter((c) => c.encryptedKey) // configured = has a stored key
      .map((c) => ({ provider: c.provider, model: c.model ?? null }));
    res.json({ success: true, providers, litellm: litellmInfo.models });
  } catch (err) {
    log.error("[evals] gen-models error:", err);
    res.status(500).json({ success: false, error: "Failed to list generation models" });
  }
});

// ── Named judges (create-your-own) ──────────────────────────────────────────
// GET /evals/judges — list judges (seeds a built-in "Default" on first access).
router.get("/judges", async (_req: Request, res: Response) => {
  try {
    const judges = await evalRepository.listJudges();
    res.json({ success: true, judges });
  } catch (err) {
    log.error("[evals] listJudges error:", err);
    res.status(500).json({ success: false, error: "Failed to list judges" });
  }
});

// POST /evals/judges — create a judge { name, prompt, model? }.
router.post("/judges", async (req: Request, res: Response) => {
  const { name, prompt, model } = req.body as { name?: string; prompt?: string; model?: string };
  if (!name?.trim() || !prompt?.trim()) {
    res.status(400).json({ success: false, error: "name and prompt are required" });
    return;
  }
  try {
    const userId = getRequesterId(req);
    const judge = await evalRepository.createJudge({
      name: name.trim(),
      prompt,
      model: model?.trim() || "",
      ...(userId ? { createdBy: userId } : {}),
    });
    res.json({ success: true, judge });
  } catch (err) {
    log.error("[evals] createJudge error:", err);
    res.status(500).json({ success: false, error: "Failed to create judge" });
  }
});

// PUT /evals/judges/:id — update { name?, prompt?, model? }.
router.put("/judges/:id", async (req: Request<{ id: string }>, res: Response) => {
  const { name, prompt, model } = req.body as { name?: string; prompt?: string; model?: string };
  try {
    const judge = await evalRepository.updateJudge(req.params.id, {
      ...(name !== undefined ? { name } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      ...(model !== undefined ? { model } : {}),
    });
    res.json({ success: true, judge });
  } catch (err) {
    log.error("[evals] updateJudge error:", err);
    res.status(500).json({ success: false, error: "Failed to update judge" });
  }
});

// DELETE /evals/judges/:id — remove a judge (the built-in Default can't be deleted).
router.delete("/judges/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    await evalRepository.deleteJudge(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Failed to delete judge" });
  }
});

// POST /evals/generations/:id/judge — on-demand semantic judging of a run's turns.
// Body: { model?, prompt?, conversationIds? }. Scope to specific conversations
// (per-conversation judge) or omit for the whole run (per-project judge). Only
// turns that have BOTH an expectedResponse and a clawAnswer are gradable; the
// rest are skipped. Re-judging overwrites prior verdicts.
router.post("/generations/:id/judge", async (req: Request<{ id: string }>, res: Response) => {
  const { judges, conversationIds, onlyUnscored } = req.body as {
    /** Selected judges, each with the model that runs it for this pass. */
    judges?: Array<{ judgeId?: string; model?: string }>;
    conversationIds?: string[];
    onlyUnscored?: boolean;
  };
  try {
    const run = await evalRepository.getRun(req.params.id);
    if (!run) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }
    // Resolve judge specs: the explicit selection, else the built-in Default.
    let specs: Array<{ judgeId: string; model?: string }> = Array.isArray(judges)
      ? judges
          .filter((j) => j && typeof j.judgeId === "string" && j.judgeId)
          .map((j) => ({ judgeId: j.judgeId as string, ...(j.model && typeof j.model === "string" && j.model.trim() ? { model: j.model.trim() } : {}) }))
      : [];
    if (specs.length === 0) {
      specs = (await evalRepository.listJudges()).filter((j) => j.isDefault).map((j) => ({ judgeId: j.id }));
    }
    if (specs.length === 0) {
      res.status(400).json({ success: false, error: "No judges selected" });
      return;
    }
    const userId = getRequesterId(req);
    const jobId = await enqueueEvalJudge({
      runId: req.params.id,
      judges: specs,
      ...(Array.isArray(conversationIds) ? { conversationIds } : {}),
      ...(onlyUnscored ? { onlyUnscored: true } : {}),
      ...(userId ? { userId } : {}),
    });
    res.json({ success: true, jobId });
  } catch (err) {
    log.error("[evals] judge enqueue error:", err);
    res.status(500).json({ success: false, error: "Failed to start scoring" });
  }
});

// GET /evals/judge-jobs/:jobId — poll background scoring progress.
router.get("/judge-jobs/:jobId", async (req: Request<{ jobId: string }>, res: Response) => {
  try {
    const status = await getEvalJudgeStatus(req.params.jobId);
    if (!status) {
      res.status(404).json({ success: false, error: "Job not found" });
      return;
    }
    res.json({ success: true, ...status });
  } catch (err) {
    log.error("[evals] judge-job status error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch job status" });
  }
});

// POST /evals/judge-jobs/:jobId/cancel — request cancellation.
router.post("/judge-jobs/:jobId/cancel", async (req: Request<{ jobId: string }>, res: Response) => {
  try {
    const ok = await cancelEvalJudge(req.params.jobId);
    res.json({ success: ok });
  } catch (err) {
    log.error("[evals] judge-job cancel error:", err);
    res.status(500).json({ success: false, error: "Failed to cancel job" });
  }
});


export { router as evalJudgingRouter };
