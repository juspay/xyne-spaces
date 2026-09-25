/**
 * Evals — generations: background generation creation, job polling, generation
 * detail (+ judge summary), per-folder listings.
 */
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { evalRepository, agentRepository } from "../../repositories/index.js";
import { getOrgId, getRequesterId } from "../../middleware/agent-acl.js";
import { enqueueEvalGeneration, getEvalGenerationStatus, cancelEvalGeneration } from "../../queue/eval-generation-queue.js";

import { createLogger } from "../../logger.js";
const log = createLogger("generations");

const router = Router();

/** Max agents that can be compared in a single run. */
const MAX_COMPARE_AGENTS = 3;

/** One agent to run in a comparison, with its own optional generation-model pin. */
interface AgentSpec {
  agentSlug: string;
  genProvider: string | null;
  genModel: string | null;
  optimizations: string | null;
  judgeBackend: string | null;
}

const OPTIMIZATIONS_SPEC = /^[a-z0-9_,+\-]{1,400}$/i;
const JUDGE_BACKEND_SPEC = /^[a-z0-9_]{1,40}$/i;

export function armDisplayModel(spec: Pick<AgentSpec, "genModel" | "optimizations" | "judgeBackend">): string | null {
  const tags = [
    spec.optimizations ? `opts:${spec.optimizations}` : "",
    spec.judgeBackend ? `judge:${spec.judgeBackend}` : "",
  ].filter(Boolean);
  if (tags.length === 0) return spec.genModel;
  return `${spec.genModel ?? "default"} · ${tags.join(" · ")}`;
}

/** Normalize the request body into 1-3 agent specs. Supports the multi-agent
 *  shape { agents: [{ agentSlug, genProvider?, genModel? }] } and the legacy
 *  single-agent shape { agentSlug, genProvider?, genModel? }. Dedupes by slug + optimization/judge arm, so one agent can be compared against itself. */
export function parseAgentSpecs(body: unknown): { specs: AgentSpec[]; legacy: boolean } | { error: string } {
  const b = (body ?? {}) as {
    agents?: Array<{ agentSlug?: unknown; genProvider?: unknown; genModel?: unknown; optimizations?: unknown; judgeBackend?: unknown }>;
    agentSlug?: unknown;
    genProvider?: unknown;
    genModel?: unknown;
    optimizations?: unknown;
    judgeBackend?: unknown;
  };
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const matching = (v: unknown, shape: RegExp): string | null => {
    const value = str(v);
    return value && shape.test(value) ? value.toLowerCase() : null;
  };
  if (Array.isArray(b.agents) && b.agents.length > 0) {
    const seen = new Set<string>();
    const specs: AgentSpec[] = [];
    for (const a of b.agents) {
      const slug = str(a?.agentSlug);
      if (!slug) continue;
      const spec: AgentSpec = {
        agentSlug: slug,
        genProvider: str(a?.genProvider),
        genModel: str(a?.genModel),
        optimizations: matching(a?.optimizations, OPTIMIZATIONS_SPEC),
        judgeBackend: matching(a?.judgeBackend, JUDGE_BACKEND_SPEC),
      };
      const armKey = [spec.agentSlug, spec.optimizations ?? "", spec.judgeBackend ?? ""].join("|");
      if (seen.has(armKey)) continue;
      seen.add(armKey);
      specs.push(spec);
    }
    if (specs.length === 0) return { error: "At least one agent is required" };
    if (specs.length > MAX_COMPARE_AGENTS) return { error: `At most ${MAX_COMPARE_AGENTS} agents can be compared` };
    return { specs, legacy: false };
  }
  const slug = str(b.agentSlug);
  if (slug) {
    return {
      specs: [{
        agentSlug: slug,
        genProvider: str(b.genProvider),
        genModel: str(b.genModel),
        optimizations: matching(b.optimizations, OPTIMIZATIONS_SPEC),
        judgeBackend: matching(b.judgeBackend, JUDGE_BACKEND_SPEC),
      }],
      legacy: true,
    };
  }
  return { error: "agentSlug is required" };
}

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
// immediately; poll GET /run-jobs/:jobId.
//
// Multi-agent: pass { agents: [{ agentSlug, genProvider?, genModel? }] } (1-3) to
// compare several agents over the same conversations. Each agent gets its own
// EvalGeneration (own runId, own generation-model pin, own turns) and they share
// a comparisonId so the UI can align them side by side. Same-provider agents
// serialize naturally on the worker's per-provider stream slot. The legacy
// single-agent shape { agentSlug, genProvider?, genModel? } still works.
router.post("/generations/background", async (req: Request, res: Response) => {
  const { conversationIds, folderId } = req.body as { conversationIds?: string[]; folderId?: string };
  const parsed = parseAgentSpecs(req.body);
  if ("error" in parsed) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }
  const { specs, legacy } = parsed;
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Unauthenticated" });
    return;
  }
  const orgId = getOrgId(req);
  if (!orgId) {
    log.warn(`[generations/background] orgId is required userId=${userId} agents=${specs.map((s) => s.agentSlug).join(",")} folderId=${folderId ?? "none"}`);
    res.status(400).json({ success: false, error: "orgId is required" });
    return;
  }
  try {
    // ACL: every agent must resolve within the caller's org (cross-org = 404).
    for (const s of specs) {
      const agent = await agentRepository.findBySlug(s.agentSlug, orgId);
      if (!agent) {
        res.status(404).json({ success: false, error: `Agent not found: ${s.agentSlug}` });
        return;
      }
    }
    let ids = Array.isArray(conversationIds) ? conversationIds.filter((x) => typeof x === "string") : [];
    if (ids.length === 0 && folderId) ids = await evalRepository.listConversationIds(folderId);
    if (ids.length === 0) {
      res.status(400).json({ success: false, error: "No conversations to run" });
      return;
    }

    const enqueueFor = (spec: AgentSpec, runId: string) =>
      enqueueEvalGeneration({
        runId,
        agentSlug: spec.agentSlug,
        userId,
        conversationIds: ids,
        ...(spec.genProvider ? { genProvider: spec.genProvider } : {}),
        ...(spec.genModel ? { genModel: spec.genModel } : {}),
        ...(spec.optimizations ? { optimizations: spec.optimizations } : {}),
        ...(spec.judgeBackend ? { judgeBackend: spec.judgeBackend } : {}),
      });

    // Legacy single-agent callers keep the flat { runId, jobId } shape (no group).
    if (legacy) {
      const spec = specs[0]!;
      const run = await evalRepository.createRun({
        agentSlug: spec.agentSlug,
        conversationIds: ids,
        folderId: folderId ?? null,
        createdBy: userId,
        genProvider: spec.genProvider,
        genModel: armDisplayModel(spec),
        orgId,
      });
      const jobId = await enqueueFor(spec, run.id);
      res.json({ success: true, runId: run.id, jobId });
      return;
    }

    // Multi-agent (incl. a comparison of one): create all sibling rows atomically
    // (one transaction) so a mid-fan-out DB failure can't orphan half a comparison,
    // then enqueue a job per run. If an enqueue fails, cancel the jobs already
    // started and mark every sibling run failed so none is left stuck at "running".
    const comparisonId = randomUUID();
    const createdRuns = await evalRepository.createComparisonRuns(
      specs.map((spec, i) => ({
        agentSlug: spec.agentSlug,
        conversationIds: ids,
        folderId: folderId ?? null,
        createdBy: userId,
        genProvider: spec.genProvider,
        genModel: armDisplayModel(spec),
        orgId,
        comparisonId,
        comparisonSeq: i,
      })),
    );
    const runs: Array<{ agentSlug: string; runId: string; jobId: string }> = [];
    try {
      for (let i = 0; i < createdRuns.length; i++) {
        const run = createdRuns[i]!;
        const spec = specs[i]!;
        const jobId = await enqueueFor(spec, run.id);
        runs.push({ agentSlug: spec.agentSlug, runId: run.id, jobId });
      }
    } catch (enqErr) {
      await Promise.all(runs.map((r) => cancelEvalGeneration(r.jobId).catch(() => {})));
      await Promise.all(createdRuns.map((r) => evalRepository.updateRunStatus(r.id, "failed").catch(() => {})));
      throw enqErr;
    }
    res.json({ success: true, comparisonId, runs });
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

// GET /evals/comparisons/:comparisonId — all sibling agent runs of a comparison,
// each with its turn results + a per-agent score summary (for side-by-side view).
router.get("/comparisons/:comparisonId", async (req: Request<{ comparisonId: string }>, res: Response) => {
  try {
    const runs = await evalRepository.getComparison(req.params.comparisonId);
    // Cross-org guard: a comparison is only visible within its own org (all its
    // sibling runs share one orgId). Absent/mismatched org → 404, not a leak.
    const orgId = getOrgId(req);
    if (runs.length === 0 || runs.some((r) => r.orgId !== orgId)) {
      res.status(404).json({ success: false, error: "Comparison not found" });
      return;
    }
    const agents = runs.map((run) => ({ run, summary: summarizeRun(run.turnResults) }));
    res.json({ success: true, comparisonId: req.params.comparisonId, agents });
  } catch (err) {
    log.error("[evals] getComparison error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch comparison" });
  }
});

export { router as evalGenerationsRouter };
