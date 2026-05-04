import { Router, type Request, type Response } from "express";
import { agentRunRepository, agentRepository } from "../repositories/index.js";
import { getRequesterId } from "../middleware/agent-acl.js";
import { renderClaudeCodeJsonl, renderMarkdown, renderClaudeProjectZip, type SessionExportRun } from "../lib/session-export.js";

const router = Router();

// GET /runs — list runs for the requesting user
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
    const conversationId = typeof req.query["conversationId"] === "string" ? req.query["conversationId"] : undefined;
    const agentSlug = typeof req.query["agentSlug"] === "string" ? req.query["agentSlug"] : undefined;
    const limit = typeof req.query["limit"] === "string" ? Math.min(parseInt(req.query["limit"], 10) || 50, 200) : 50;
    const runs = await agentRunRepository.listByUser(userId, {
      ...(status ? { status } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(agentSlug ? { agentSlug } : {}),
      limit,
    });
    res.json({ success: true, data: runs });
  } catch (err) {
    console.error("[runs] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /runs/session/export — download a full session (thread + agent) as Claude Code .jsonl or markdown.
// Must be declared BEFORE /:sessionId so the literal path takes precedence.
router.get("/session/export", async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const conversationId = typeof req.query["conversationId"] === "string" ? req.query["conversationId"] : undefined;
    const agentSlug = typeof req.query["agentSlug"] === "string" ? req.query["agentSlug"] : undefined;
    const format = typeof req.query["format"] === "string" ? req.query["format"] : "claude-code";
    if (!conversationId || !agentSlug) {
      res.status(400).json({ success: false, error: "conversationId and agentSlug are required" });
      return;
    }
    if (format !== "claude-code" && format !== "markdown" && format !== "claude-project") {
      res.status(400).json({ success: false, error: "format must be 'claude-code', 'markdown', or 'claude-project'" });
      return;
    }

    // Fetch all runs in the session, oldest first. listByUser already enforces userId ownership.
    const runs = await agentRunRepository.listByUser(userId, { conversationId, agentSlug, limit: 200 });
    if (runs.length === 0) {
      res.status(404).json({ success: false, error: "No runs found for this session" });
      return;
    }
    const ordered = runs.slice().sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    const exportRuns: SessionExportRun[] = ordered.map((r) => ({
      sessionId: r.sessionId,
      agentSlug: r.agentSlug,
      task: r.task,
      result: r.result,
      error: r.error,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      toolInvocations: Array.isArray(r.toolInvocations) ? (r.toolInvocations as unknown as SessionExportRun["toolInvocations"]) : null,
    }));

    // Use latest run's sessionId as the canonical file id — matches what users see in the drawer.
    const canonicalSessionId = ordered[ordered.length - 1]!.sessionId;

    if (format === "markdown") {
      const body = renderMarkdown(exportRuns, { agentSlug, conversationId });
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${canonicalSessionId}.md"`);
      res.send(body);
      return;
    }

    if (format === "claude-project") {
      // Full zip bundle: CLAUDE.md (agent prompt) + .claude/agents/*.md (subagents) + .claude/skills/*.md (attached skills) + session jsonl + README
      const agentRow = await agentRepository.findBySlugWithRelations(agentSlug);
      if (!agentRow) {
        res.status(404).json({ success: false, error: "Agent not found" });
        return;
      }
      const skills = (agentRow.skills ?? []).map((as) => ({
        slug: as.skill.slug,
        name: as.skill.name,
        description: as.skill.description ?? "",
        content: as.skill.content ?? "",
      }));
      const zipBuffer = await renderClaudeProjectZip({
        agent: {
          slug: agentRow.slug,
          name: agentRow.name,
          description: agentRow.description ?? "",
          systemPrompt: agentRow.systemPrompt ?? "",
        },
        skills,
        runs: exportRuns,
        sessionId: canonicalSessionId,
      });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${canonicalSessionId}.zip"`);
      res.send(zipBuffer);
      return;
    }

    // claude-code jsonl
    const body = renderClaudeCodeJsonl(exportRuns, canonicalSessionId);
    res.setHeader("Content-Type", "application/jsonl; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${canonicalSessionId}.jsonl"`);
    res.send(body);
  } catch (err) {
    console.error("[runs] session export error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /runs/:sessionId — single run detail
router.get("/:sessionId", async (req: Request<{ sessionId: string }>, res: Response) => {
  try {
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const run = await agentRunRepository.findBySessionId(req.params.sessionId);
    if (!run) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }
    if (run.userId !== userId) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    res.json({ success: true, data: run });
  } catch (err) {
    console.error("[runs] get error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /runs/:sessionId/rate — thumbs up/down + optional comment
router.post("/:sessionId/rate", async (req: Request<{ sessionId: string }>, res: Response) => {
  try {
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const { rating, comment } = req.body as { rating?: string; comment?: string | null };
    if (rating !== "up" && rating !== "down") {
      res.status(400).json({ success: false, error: "rating must be 'up' or 'down'" });
      return;
    }
    const run = await agentRunRepository.findBySessionId(req.params.sessionId);
    if (!run) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }
    if (run.userId !== userId) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    await agentRunRepository.rate(req.params.sessionId, userId, rating, comment ?? null);
    res.json({ success: true });
  } catch (err) {
    console.error("[runs] rate error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export const runsRouter = router;
