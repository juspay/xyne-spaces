/**
 * Evals — generations: background generation creation, job polling, generation
 * detail (+ judge summary), per-folder listings.
 */
import { Router, type Request, type Response } from "express";
import { evalRepository } from "../../repositories/index.js";
import { getRequesterId } from "../../middleware/agent-acl.js";
import { enqueueEvalGeneration, getEvalGenerationStatus, cancelEvalGeneration } from "../../queue/eval-generation-queue.js";

import { createLogger } from "../../logger.js";
const log = createLogger("generations");

const router = Router();

/** Roll up per-turn matchScores into the overview report. Only turns that have
 *  been judged (matchScore != null) count toward averages/distribution. */
function summarizeRun(turns: Array<{ conversationId: string; matchScore: number | null }>) {
  const judged = turns.filter((t) => typeof t.matchScore === "number") as Array<{
    conversationId: string;
    matchScore: number;
  }>;
  const dist = { good: 0, weak: 0, fail: 0 }; // >=80 / 50-79 / <50
  const byConv = new Map<string, { sum: number; count: number }>();
  for (const t of judged) {
    if (t.matchScore >= 80) dist.good++;
    else if (t.matchScore >= 50) dist.weak++;
    else dist.fail++;
    const c = byConv.get(t.conversationId) ?? { sum: 0, count: 0 };
    c.sum += t.matchScore;
    c.count++;
    byConv.set(t.conversationId, c);
  }
  const avgScore = judged.length ? Math.round(judged.reduce((s, t) => s + t.matchScore, 0) / judged.length) : null;
  return {
    judgedCount: judged.length,
    totalTurns: turns.length,
    avgScore,
    distribution: dist,
    perConversation: [...byConv.entries()].map(([conversationId, v]) => ({
      conversationId,
      avgScore: Math.round(v.sum / v.count),
      count: v.count,
    })),
  };
}

// ── Generations ───────────────────────────────────────────────────────────

// POST /evals/generations/background — start a run as a resilient background job
// (replays conversations against the agent server-side). Returns runId + jobId
// immediately; poll GET /run-jobs/:jobId. Body: { agentSlug, conversationIds?, folderId? }.
router.post("/generations/background", async (req: Request, res: Response) => {
  const { agentSlug, conversationIds, folderId, genProvider, genModel } = req.body as {
    agentSlug?: string;
    conversationIds?: string[];
    folderId?: string;
    /** Pin the generation LLM for the run ("spaces" | "copilot" | "claude" | "codex" + model). */
    genProvider?: string;
    genModel?: string;
  };
  if (!agentSlug || typeof agentSlug !== "string") {
    res.status(400).json({ success: false, error: "agentSlug is required" });
    return;
  }
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Unauthenticated" });
    return;
  }
  try {
    let ids = Array.isArray(conversationIds) ? conversationIds.filter((x) => typeof x === "string") : [];
    if (ids.length === 0 && folderId) ids = await evalRepository.listConversationIds(folderId);
    if (ids.length === 0) {
      res.status(400).json({ success: false, error: "No conversations to run" });
      return;
    }
    const pin = genProvider && typeof genProvider === "string" ? genProvider : null;
    const pinModel = genModel && typeof genModel === "string" ? genModel : null;
    const run = await evalRepository.createRun({
      agentSlug,
      conversationIds: ids,
      folderId: folderId ?? null,
      createdBy: userId,
      genProvider: pin,
      genModel: pinModel,
    });
    const jobId = await enqueueEvalGeneration({
      runId: run.id,
      agentSlug,
      userId,
      conversationIds: ids,
      ...(pin ? { genProvider: pin } : {}),
      ...(pinModel ? { genModel: pinModel } : {}),
    });
    res.json({ success: true, runId: run.id, jobId });
  } catch (err) {
    log.error("[evals] background run enqueue error:", err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Failed to start run" });
  }
});

// GET /evals/generation-jobs/:jobId — background run progress.
router.get("/generation-jobs/:jobId", async (req: Request<{ jobId: string }>, res: Response) => {
  try {
    const status = await getEvalGenerationStatus(req.params.jobId);
    if (!status) {
      res.status(404).json({ success: false, error: "Job not found" });
      return;
    }
    res.json({ success: true, ...status });
  } catch (err) {
    log.error("[evals] run-job status error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch run status" });
  }
});

// POST /evals/generation-jobs/:jobId/cancel
router.post("/generation-jobs/:jobId/cancel", async (req: Request<{ jobId: string }>, res: Response) => {
  try {
    const ok = await cancelEvalGeneration(req.params.jobId);
    res.json({ success: ok });
  } catch (err) {
    log.error("[evals] run-job cancel error:", err);
    res.status(500).json({ success: false, error: "Failed to cancel run" });
  }
});

// GET /evals/generations/:id — run + turn results + judge summary (UI polls / reloads)
router.get("/generations/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const run = await evalRepository.getRun(req.params.id);
    if (!run) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }
    res.json({ success: true, run, summary: summarizeRun(run.turnResults) });
  } catch (err) {
    log.error("[evals] getRun error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch run" });
  }
});

// GET /evals/folders/:id/generations — all runs for this folder (compare picker)
router.get("/folders/:id/generations", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const runs = await evalRepository.listRunsForFolder(req.params.id);
    res.json({ success: true, runs });
  } catch (err) {
    log.error("[evals] listRunsForFolder error:", err);
    res.status(500).json({ success: false, error: "Failed to list runs" });
  }
});

// GET /evals/folders/:id/latest-generation — latest run targeting this folder (overlay)
router.get("/folders/:id/latest-generation", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const run = await evalRepository.latestRunForFolder(req.params.id);
    res.json({ success: true, run });
  } catch (err) {
    log.error("[evals] latestRunForFolder error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch latest run" });
  }
});

export { router as evalGenerationsRouter };
