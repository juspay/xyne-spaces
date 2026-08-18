/**
 * S2S endpoint that exposes the goal-judge to claw-auth.
 *
 * Same pattern as the user-memory-curator endpoint: LLM lives on claw (where
 * LITELLM_API_KEY is set), claw-auth POSTs the inputs and gets back a
 * structured `{done, reason}`.
 */
import { Router, type Request, type Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { createLogger } from "../logger.js";
import { judgeGoalProgress, type GoalJudgeInput } from "../goal-judge.js";

const router = Router();
const log = createLogger("goal-judge-route");

router.post("/goal-judge", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Partial<GoalJudgeInput> | undefined;
    if (!body || typeof body.condition !== "string" || body.condition.trim().length === 0) {
      res.status(400).json({ success: false, error: "condition is required" });
      return;
    }
    if (typeof body.lastTurnOutput !== "string") {
      res.status(400).json({ success: false, error: "lastTurnOutput must be a string" });
      return;
    }
    if (typeof body.turnCount !== "number" || typeof body.maxTurns !== "number") {
      res.status(400).json({ success: false, error: "turnCount and maxTurns must be numbers" });
      return;
    }

    const recentTurnsDigest =
      typeof body.recentTurnsDigest === "string" ? body.recentTurnsDigest.slice(0, 12000) : undefined;

    // Sanitize attachmentsThisTurn — metadata only, defensively typed,
    // capped so a runaway worker can't blow up the judge's context window.
    const rawAttachments = Array.isArray(body.attachmentsThisTurn) ? body.attachmentsThisTurn : [];
    const attachmentsThisTurn = rawAttachments
      .filter((a): a is { fileName: string; mimeType: string; sizeBytes: number } =>
        !!a &&
        typeof a === "object" &&
        typeof (a as { fileName?: unknown }).fileName === "string" &&
        typeof (a as { mimeType?: unknown }).mimeType === "string" &&
        typeof (a as { sizeBytes?: unknown }).sizeBytes === "number",
      )
      .slice(0, 50)
      .map((a) => ({
        fileName: a.fileName.slice(0, 256),
        mimeType: a.mimeType.slice(0, 128),
        sizeBytes: a.sizeBytes,
      }));

    const decision = await judgeGoalProgress({
      condition: body.condition,
      lastTurnOutput: body.lastTurnOutput,
      turnCount: body.turnCount,
      maxTurns: body.maxTurns,
      ...(recentTurnsDigest ? { recentTurnsDigest } : {}),
      ...(attachmentsThisTurn.length > 0 ? { attachmentsThisTurn } : {}),
    });

    res.json({ success: true, ...decision });
  } catch (err) {
    log.error(`[goal-judge-route] failed: ${err instanceof Error ? err.message : String(err)}`);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
    }
  }
});

export { router as goalJudgeRouter };
